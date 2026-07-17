import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from '@/db/client';
import { activities, plannedWorkouts } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava } from './users';
import { syncActivity } from './activity-sync';

function mockStravaActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: 900,
    sport_type: 'Run',
    start_date_local: '2026-07-10T06:00:00Z',
    moving_time: 1800,
    distance: 5000,
    average_speed: 2.78,
    ...overrides,
  };
}

describe('syncActivity', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function createConnectedUser(stravaAthleteId: number) {
    return upsertUserFromStrava(
      { id: stravaAthleteId, firstname: 'Test', lastname: 'Athlete', timezone: null },
      { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date() },
    );
  }

  it('stores the activity and leaves it unmatched when no planned workout exists', async () => {
    const user = await createConnectedUser(201);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => mockStravaActivity() }));

    await syncActivity(201, 900);

    const [stored] = await db.select().from(activities).where(eq(activities.userId, user.id));
    expect(stored.stravaActivityId).toBe(900);
    expect(stored.matchedPlannedWorkoutId).toBeNull();
  });

  it('matches a same-day/same-sport planned workout and marks it completed', async () => {
    const user = await createConnectedUser(202);
    const [planned] = await db
      .insert(plannedWorkouts)
      .values({
        userId: user.id,
        date: new Date('2026-07-10'),
        sport: 'run',
        workoutType: 'easy',
        status: 'planned',
        source: 'user',
      })
      .returning();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => mockStravaActivity() }));

    await syncActivity(202, 900);

    const [stored] = await db.select().from(activities).where(eq(activities.userId, user.id));
    expect(stored.matchedPlannedWorkoutId).toBe(planned.id);

    const [updatedWorkout] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, planned.id));
    expect(updatedWorkout.status).toBe('completed');
  });

  it('is idempotent — syncing the same activity twice stores exactly one row', async () => {
    const user = await createConnectedUser(203);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => mockStravaActivity() }));

    await syncActivity(203, 900);
    await syncActivity(203, 900);

    const stored = await db.select().from(activities).where(eq(activities.userId, user.id));
    expect(stored).toHaveLength(1);
  });

  it('does nothing when the Strava athlete id has no local user', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await syncActivity(999999, 900);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
