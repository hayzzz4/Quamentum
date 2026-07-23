import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { db } from '@/db/client';
import { checkins } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava } from '@/lib/users';
import { todayUTC } from '@/lib/checkin';
import * as sessionModule from '@/lib/session';
import { POST } from './route';

function formRequest(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return new NextRequest('http://localhost/api/checkin', { method: 'POST', body: formData });
}

async function createTestUser(stravaAthleteId: number) {
  return upsertUserFromStrava(
    { id: stravaAthleteId, firstname: 'Test', lastname: 'Athlete', timezone: null },
    { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date() },
  );
}

describe('POST /api/checkin', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects unauthenticated requests to sign-in', async () => {
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(null);
    const response = await POST(formRequest({ sleepHours: '7.5', soreness: '3', energy: '3' }));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/sign-in');
  });

  it('creates a check-in for today and redirects with saved=1', async () => {
    const user = await createTestUser(901);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);

    const response = await POST(formRequest({ sleepHours: '7.5', soreness: '3', energy: '4', note: 'Felt good' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/checkin?saved=1');
    const [stored] = await db.select().from(checkins).where(eq(checkins.userId, user.id));
    expect(stored.soreness).toBe(3);
    expect(stored.energy).toBe(4);
    expect(stored.note).toBe('Felt good');
    expect(stored.date.toISOString().slice(0, 10)).toBe(todayUTC().toISOString().slice(0, 10));
  });

  it("updates today's existing check-in instead of creating a duplicate", async () => {
    const user = await createTestUser(902);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);

    await POST(formRequest({ sleepHours: '7', soreness: '2', energy: '2' }));
    await POST(formRequest({ sleepHours: '8', soreness: '5', energy: '5' }));

    const rows = await db.select().from(checkins).where(eq(checkins.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].soreness).toBe(5);
  });

  it('redirects back to /checkin with an error when required fields are invalid', async () => {
    const user = await createTestUser(903);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);

    const response = await POST(formRequest({ sleepHours: '', soreness: '3', energy: '3' }));

    expect(response.status).toBe(303);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('/checkin');
    expect(location).toContain('error=invalid');
    const stored = await db.select().from(checkins).where(eq(checkins.userId, user.id));
    expect(stored).toHaveLength(0);
  });
});
