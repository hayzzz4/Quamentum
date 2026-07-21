import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { db } from '@/db/client';
import { plannedWorkouts } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava } from '@/lib/users';
import * as sessionModule from '@/lib/session';
import { POST } from './route';

function formRequest(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return new NextRequest('http://localhost/api/plan/workouts', { method: 'POST', body: formData });
}

async function createTestUser(stravaAthleteId: number) {
  return upsertUserFromStrava(
    { id: stravaAthleteId, firstname: 'Test', lastname: 'Athlete', timezone: null },
    { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date() },
  );
}

describe('POST /api/plan/workouts', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects unauthenticated requests to sign-in', async () => {
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(null);
    const response = await POST(formRequest({ date: '2099-06-01', sport: 'run', workoutType: 'easy' }));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/sign-in');
  });

  it('creates a workout and redirects to the day page', async () => {
    const user = await createTestUser(701);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);

    const response = await POST(formRequest({ date: '2099-06-01', sport: 'run', workoutType: 'easy' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/plan/2099-06-01');
    const [stored] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.userId, user.id));
    expect(stored.sport).toBe('run');
    expect(stored.source).toBe('user');
  });

  it('redirects back to the new-workout form with an error when required fields are invalid', async () => {
    const user = await createTestUser(702);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);

    const response = await POST(formRequest({ date: '2099-06-01', sport: '', workoutType: 'easy' }));

    expect(response.status).toBe(303);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('/plan/2099-06-01/new');
    expect(location).toContain('error=invalid');
    const stored = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.userId, user.id));
    expect(stored).toHaveLength(0);
  });

  it('rejects a malformed date with a 400', async () => {
    const user = await createTestUser(703);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);

    const response = await POST(formRequest({ date: 'not-a-date', sport: 'run', workoutType: 'easy' }));
    expect(response.status).toBe(400);
  });

  it('rejects a past date with a 400', async () => {
    const user = await createTestUser(704);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);

    const response = await POST(formRequest({ date: '2000-01-01', sport: 'run', workoutType: 'easy' }));
    expect(response.status).toBe(400);
  });
});
