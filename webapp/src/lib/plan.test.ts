import { beforeEach, describe, expect, it } from 'vitest';
import { formatDateParam, isEditableDate, mondayOf, parseDateParam, parseWorkoutForm, readWorkoutFormValues, targetFieldsValid, type WorkoutFormValues } from './plan';

describe('mondayOf', () => {
  it('returns the same date when given a Monday', () => {
    expect(formatDateParam(mondayOf(new Date('2026-07-20T00:00:00Z')))).toBe('2026-07-20');
  });

  it('rolls back to Monday when given a Sunday', () => {
    expect(formatDateParam(mondayOf(new Date('2026-07-26T00:00:00Z')))).toBe('2026-07-20');
  });

  it('rolls back across a month boundary', () => {
    expect(formatDateParam(mondayOf(new Date('2026-08-02T00:00:00Z')))).toBe('2026-07-27');
  });

  it('rolls back across a year boundary', () => {
    expect(formatDateParam(mondayOf(new Date('2026-01-01T00:00:00Z')))).toBe('2025-12-29');
  });
});

describe('parseDateParam', () => {
  it('parses a valid YYYY-MM-DD string', () => {
    const date = parseDateParam('2026-07-20');
    expect(date && formatDateParam(date)).toBe('2026-07-20');
  });

  it('rejects a malformed string', () => {
    expect(parseDateParam('not-a-date')).toBeNull();
  });

  it('rejects a string with an invalid calendar date', () => {
    expect(parseDateParam('2026-02-30')).toBeNull();
  });
});

describe('isEditableDate', () => {
  const now = new Date('2026-07-20T15:00:00Z');

  it('treats today as editable', () => {
    expect(isEditableDate(new Date('2026-07-20'), now)).toBe(true);
  });

  it('treats a future date as editable', () => {
    expect(isEditableDate(new Date('2026-07-21'), now)).toBe(true);
  });

  it('treats a past date as not editable', () => {
    expect(isEditableDate(new Date('2026-07-19'), now)).toBe(false);
  });
});

describe('targetFieldsValid', () => {
  it('is valid when neither field is set', () => {
    expect(targetFieldsValid(null, null)).toBe(true);
  });

  it('is valid when both fields are set', () => {
    expect(targetFieldsValid('pace', '5:00/km')).toBe(true);
  });

  it('is invalid when only targetMetric is set', () => {
    expect(targetFieldsValid('pace', null)).toBe(false);
  });

  it('is invalid when only targetValue is set', () => {
    expect(targetFieldsValid(null, '5:00/km')).toBe(false);
  });
});

describe('parseWorkoutForm', () => {
  function values(overrides: Partial<WorkoutFormValues> = {}): WorkoutFormValues {
    return {
      sport: 'run',
      workoutType: 'easy',
      targetDurationMin: '',
      targetDistance: '',
      targetMetric: '',
      targetValue: '',
      notes: '',
      ...overrides,
    };
  }

  it('parses a minimal valid submission', () => {
    expect(parseWorkoutForm(values())).toEqual({
      sport: 'run',
      workoutType: 'easy',
      targetDurationMin: null,
      targetDistance: null,
      targetMetric: null,
      targetValue: null,
      notes: null,
    });
  });

  it('parses a fully populated submission', () => {
    const input = parseWorkoutForm(
      values({
        targetDurationMin: '45',
        targetDistance: '10',
        targetMetric: 'pace',
        targetValue: '5:00/km',
        notes: 'Keep it easy',
      }),
    );
    expect(input).toEqual({
      sport: 'run',
      workoutType: 'easy',
      targetDurationMin: 45,
      targetDistance: '10.00',
      targetMetric: 'pace',
      targetValue: '5:00/km',
      notes: 'Keep it easy',
    });
  });

  it('rejects an invalid sport', () => {
    expect(parseWorkoutForm(values({ sport: 'skiing' }))).toBeNull();
  });

  it('rejects a missing workout type', () => {
    expect(parseWorkoutForm(values({ workoutType: '' }))).toBeNull();
  });

  it('rejects an invalid target metric', () => {
    expect(parseWorkoutForm(values({ targetMetric: 'vibes', targetValue: 'good' }))).toBeNull();
  });

  it('rejects targetMetric set without targetValue', () => {
    expect(parseWorkoutForm(values({ targetMetric: 'pace' }))).toBeNull();
  });

  it('rejects targetValue set without targetMetric', () => {
    expect(parseWorkoutForm(values({ targetValue: '5:00/km' }))).toBeNull();
  });

  it('rejects a non-positive duration', () => {
    expect(parseWorkoutForm(values({ targetDurationMin: '0' }))).toBeNull();
  });

  it('rejects a non-integer duration', () => {
    expect(parseWorkoutForm(values({ targetDurationMin: '45.5' }))).toBeNull();
  });
});

describe('readWorkoutFormValues', () => {
  it('reads every field as a string, defaulting missing fields to empty', () => {
    const formData = new FormData();
    formData.set('sport', 'run');
    formData.set('workoutType', 'easy');

    expect(readWorkoutFormValues(formData)).toEqual({
      sport: 'run',
      workoutType: 'easy',
      targetDurationMin: '',
      targetDistance: '',
      targetMetric: '',
      targetValue: '',
      notes: '',
    });
  });
});

import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from '@/db/client';
import { plannedWorkouts } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava } from './users';
import { getDayPlanned, getWeekPlanned } from './plan';

async function createTestUser(stravaAthleteId: number) {
  return upsertUserFromStrava(
    { id: stravaAthleteId, firstname: 'Test', lastname: 'Athlete', timezone: null },
    { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date() },
  );
}

async function insertWorkout(userId: string, date: Date, sport: (typeof plannedWorkouts.$inferInsert)['sport'] = 'run') {
  const [row] = await db
    .insert(plannedWorkouts)
    .values({ userId, date, sport, workoutType: 'easy', status: 'planned', source: 'user' })
    .returning();
  return row;
}

describe('getWeekPlanned / getDayPlanned', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  it('returns only workouts within the requested 7-day window', async () => {
    const user = await createTestUser(501);
    await insertWorkout(user.id, new Date('2026-07-20'));
    await insertWorkout(user.id, new Date('2026-07-26'));
    await insertWorkout(user.id, new Date('2026-07-27')); // outside the window

    const week = await getWeekPlanned(user.id, new Date('2026-07-20'));
    expect(week.map((w) => w.date.toISOString().slice(0, 10)).sort()).toEqual(['2026-07-20', '2026-07-26']);
  });

  it('scopes results to the requesting user', async () => {
    const user = await createTestUser(502);
    const other = await createTestUser(503);
    await insertWorkout(user.id, new Date('2026-07-20'));
    await insertWorkout(other.id, new Date('2026-07-20'));

    const week = await getWeekPlanned(user.id, new Date('2026-07-20'));
    expect(week).toHaveLength(1);
  });

  it('returns every workout for a single day, including multiple same-day entries', async () => {
    const user = await createTestUser(504);
    await insertWorkout(user.id, new Date('2026-07-20'), 'swim');
    await insertWorkout(user.id, new Date('2026-07-20'), 'run');

    const day = await getDayPlanned(user.id, new Date('2026-07-20'));
    expect(day.map((w) => w.sport).sort()).toEqual(['run', 'swim']);
  });

  it('returns workouts in creation order', async () => {
    const user = await createTestUser(505);
    const a = await insertWorkout(user.id, new Date('2026-07-20'), 'swim');
    const b = await insertWorkout(user.id, new Date('2026-07-20'), 'run');

    const day = await getDayPlanned(user.id, new Date('2026-07-20'));
    expect(day[0].id).toBe(a.id);
    expect(day[1].id).toBe(b.id);
  });
});

import {
  createPlannedWorkout,
  deletePlannedWorkout,
  getOwnedPlannedWorkout,
  updatePlannedWorkout,
  type PlannedWorkoutInput,
} from './plan';

function baseFields(overrides: Partial<PlannedWorkoutInput> = {}): PlannedWorkoutInput {
  return {
    sport: 'run',
    workoutType: 'easy',
    targetDurationMin: null,
    targetDistance: null,
    targetMetric: null,
    targetValue: null,
    notes: null,
    ...overrides,
  };
}

describe('createPlannedWorkout', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  it('creates a workout with source=user and status=planned', async () => {
    const user = await createTestUser(601);
    const created = await createPlannedWorkout(user.id, new Date('2026-07-20'), baseFields());
    expect(created.source).toBe('user');
    expect(created.status).toBe('planned');
    expect(created.sport).toBe('run');
  });
});

describe('getOwnedPlannedWorkout', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  it('returns the workout for its owner', async () => {
    const user = await createTestUser(602);
    const created = await createPlannedWorkout(user.id, new Date('2026-07-20'), baseFields());
    expect((await getOwnedPlannedWorkout(user.id, created.id))?.id).toBe(created.id);
  });

  it('returns null when the workout belongs to another user', async () => {
    const owner = await createTestUser(603);
    const other = await createTestUser(604);
    const created = await createPlannedWorkout(owner.id, new Date('2026-07-20'), baseFields());
    expect(await getOwnedPlannedWorkout(other.id, created.id)).toBeNull();
  });

  it('returns null for a nonexistent workout id', async () => {
    const user = await createTestUser(605);
    expect(await getOwnedPlannedWorkout(user.id, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('updatePlannedWorkout', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  it('updates the fields of a workout the user owns', async () => {
    const user = await createTestUser(606);
    const created = await createPlannedWorkout(user.id, new Date('2026-07-20'), baseFields());
    const updated = await updatePlannedWorkout(
      user.id,
      created.id,
      baseFields({ workoutType: 'tempo', notes: 'Push the middle mile' }),
    );
    expect(updated?.workoutType).toBe('tempo');
    expect(updated?.notes).toBe('Push the middle mile');
  });

  it('returns null and does not update a workout owned by another user', async () => {
    const owner = await createTestUser(607);
    const other = await createTestUser(608);
    const created = await createPlannedWorkout(owner.id, new Date('2026-07-20'), baseFields());

    const result = await updatePlannedWorkout(other.id, created.id, baseFields({ workoutType: 'tempo' }));
    expect(result).toBeNull();

    const [stillOriginal] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, created.id));
    expect(stillOriginal.workoutType).toBe('easy');
  });
});

describe('deletePlannedWorkout', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  it('deletes a planned-status workout the user owns', async () => {
    const user = await createTestUser(609);
    const created = await createPlannedWorkout(user.id, new Date('2026-07-20'), baseFields());
    expect(await deletePlannedWorkout(user.id, created.id)).toBe('deleted');
    expect(await getOwnedPlannedWorkout(user.id, created.id)).toBeNull();
  });

  it('returns not_found for another user\'s workout and leaves it untouched', async () => {
    const owner = await createTestUser(610);
    const other = await createTestUser(611);
    const created = await createPlannedWorkout(owner.id, new Date('2026-07-20'), baseFields());

    expect(await deletePlannedWorkout(other.id, created.id)).toBe('not_found');
    expect(await getOwnedPlannedWorkout(owner.id, created.id)).not.toBeNull();
  });

  it('returns not_deletable for a completed workout and leaves it untouched', async () => {
    const user = await createTestUser(612);
    const created = await createPlannedWorkout(user.id, new Date('2026-07-20'), baseFields());
    await db.update(plannedWorkouts).set({ status: 'completed' }).where(eq(plannedWorkouts.id, created.id));

    expect(await deletePlannedWorkout(user.id, created.id)).toBe('not_deletable');
    const [stillThere] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, created.id));
    expect(stillThere.status).toBe('completed');
  });
});
