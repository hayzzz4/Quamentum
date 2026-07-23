import { beforeEach, describe, expect, it } from 'vitest';
import { parseCheckinForm, readCheckinFormValues, type CheckinFormValues } from './checkin';

describe('parseCheckinForm', () => {
  function values(overrides: Partial<CheckinFormValues> = {}): CheckinFormValues {
    return {
      sleepHours: '7.5',
      soreness: '3',
      energy: '3',
      note: '',
      ...overrides,
    };
  }

  it('parses a fully valid submission', () => {
    expect(parseCheckinForm(values())).toEqual({
      sleepHours: '7.50',
      soreness: 3,
      energy: 3,
      note: null,
    });
  });

  it('rejects a missing sleepHours', () => {
    expect(parseCheckinForm(values({ sleepHours: '' }))).toBeNull();
  });

  it('rejects a negative sleepHours', () => {
    expect(parseCheckinForm(values({ sleepHours: '-1' }))).toBeNull();
  });

  it('rejects sleepHours above 24', () => {
    expect(parseCheckinForm(values({ sleepHours: '25' }))).toBeNull();
  });

  it('rejects a missing soreness', () => {
    expect(parseCheckinForm(values({ soreness: '' }))).toBeNull();
  });

  it('rejects soreness below the 1-5 range', () => {
    expect(parseCheckinForm(values({ soreness: '0' }))).toBeNull();
  });

  it('rejects soreness above the 1-5 range', () => {
    expect(parseCheckinForm(values({ soreness: '6' }))).toBeNull();
  });

  it('accepts soreness at the boundary values 1 and 5', () => {
    expect(parseCheckinForm(values({ soreness: '1' }))?.soreness).toBe(1);
    expect(parseCheckinForm(values({ soreness: '5' }))?.soreness).toBe(5);
  });

  it('rejects a missing energy', () => {
    expect(parseCheckinForm(values({ energy: '' }))).toBeNull();
  });

  it('rejects energy below the 1-5 range', () => {
    expect(parseCheckinForm(values({ energy: '0' }))).toBeNull();
  });

  it('rejects energy above the 1-5 range', () => {
    expect(parseCheckinForm(values({ energy: '6' }))).toBeNull();
  });

  it('accepts energy at the boundary values 1 and 5', () => {
    expect(parseCheckinForm(values({ energy: '1' }))?.energy).toBe(1);
    expect(parseCheckinForm(values({ energy: '5' }))?.energy).toBe(5);
  });

  it('trims a whitespace-only note to null', () => {
    expect(parseCheckinForm(values({ note: '   ' }))?.note).toBeNull();
  });

  it('keeps a non-empty note', () => {
    expect(parseCheckinForm(values({ note: 'Felt great' }))?.note).toBe('Felt great');
  });
});

describe('readCheckinFormValues', () => {
  it('reads every field as a string, defaulting missing fields to empty', () => {
    const formData = new FormData();
    formData.set('sleepHours', '7.5');
    formData.set('soreness', '3');

    expect(readCheckinFormValues(formData)).toEqual({
      sleepHours: '7.5',
      soreness: '3',
      energy: '',
      note: '',
    });
  });
});

import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from '@/db/client';
import { checkins } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava } from './users';
import { getTodayCheckin, todayUTC, upsertCheckin, type CheckinInput } from './checkin';

async function createTestUser(stravaAthleteId: number) {
  return upsertUserFromStrava(
    { id: stravaAthleteId, firstname: 'Test', lastname: 'Athlete', timezone: null },
    { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date() },
  );
}

function baseFields(overrides: Partial<CheckinInput> = {}): CheckinInput {
  return {
    sleepHours: '7.50',
    soreness: 3,
    energy: 3,
    note: null,
    ...overrides,
  };
}

describe('todayUTC', () => {
  it('floors a timestamp to UTC midnight', () => {
    const now = new Date('2026-07-23T15:42:00Z');
    expect(todayUTC(now).toISOString()).toBe('2026-07-23T00:00:00.000Z');
  });
});

describe('upsertCheckin / getTodayCheckin', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  it('creates a new row when none exists for that user and date', async () => {
    const user = await createTestUser(801);
    const date = new Date('2026-07-20');

    await upsertCheckin(user.id, date, baseFields());

    const stored = await getTodayCheckin(user.id, date);
    expect(stored?.soreness).toBe(3);
    expect(stored?.sleepHours).toBe('7.50');
  });

  it('updates the existing row instead of creating a duplicate', async () => {
    const user = await createTestUser(802);
    const date = new Date('2026-07-20');

    await upsertCheckin(user.id, date, baseFields());
    await upsertCheckin(user.id, date, baseFields({ soreness: 5, note: 'Sore today' }));

    const rows = await db.select().from(checkins).where(eq(checkins.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].soreness).toBe(5);
    expect(rows[0].note).toBe('Sore today');
  });

  it('returns null when no check-in exists for that date', async () => {
    const user = await createTestUser(803);
    expect(await getTodayCheckin(user.id, new Date('2026-07-20'))).toBeNull();
  });

  it('scopes results to the requesting user', async () => {
    const user = await createTestUser(804);
    const other = await createTestUser(805);
    const date = new Date('2026-07-20');
    await upsertCheckin(other.id, date, baseFields());

    expect(await getTodayCheckin(user.id, date)).toBeNull();
  });
});
