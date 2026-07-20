import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { db } from '@/db/client';
import { plannedWorkouts } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava } from '@/lib/users';
import { createPlannedWorkout, type PlannedWorkoutInput } from '@/lib/plan';
import * as sessionModule from '@/lib/session';
import { POST } from './route';

const FUTURE_DATE = new Date('2099-06-01');
const PAST_DATE = new Date('2000-01-01');

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

function deleteRequest(id: string) {
  return new NextRequest(`http://localhost/api/plan/workouts/${id}/delete`, { method: 'POST' });
}

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function createTestUser(stravaAthleteId: number) {
  return upsertUserFromStrava(
    { id: stravaAthleteId, firstname: 'Test', lastname: 'Athlete', timezone: null },
    { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date() },
  );
}

describe('POST /api/plan/workouts/[id]/delete', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes a planned workout and redirects to the day page', async () => {
    const user = await createTestUser(901);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);
    const workout = await createPlannedWorkout(user.id, FUTURE_DATE, baseFields());

    const response = await POST(deleteRequest(workout.id), routeParams(workout.id));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/plan/2099-06-01');
    const stored = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, workout.id));
    expect(stored).toHaveLength(0);
  });

  it('returns 404 for a workout owned by another user, and leaves it untouched', async () => {
    const owner = await createTestUser(902);
    const other = await createTestUser(903);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(other.id);
    const workout = await createPlannedWorkout(owner.id, FUTURE_DATE, baseFields());

    const response = await POST(deleteRequest(workout.id), routeParams(workout.id));

    expect(response.status).toBe(404);
    const [stored] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, workout.id));
    expect(stored).toBeDefined();
  });

  it('rejects deleting a past-dated workout with a 400, leaving it untouched', async () => {
    const user = await createTestUser(904);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);
    const workout = await createPlannedWorkout(user.id, PAST_DATE, baseFields());

    const response = await POST(deleteRequest(workout.id), routeParams(workout.id));

    expect(response.status).toBe(400);
    const [stored] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, workout.id));
    expect(stored).toBeDefined();
  });

  it('rejects deleting a completed/matched workout with a 400, leaving it untouched', async () => {
    const user = await createTestUser(905);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);
    const workout = await createPlannedWorkout(user.id, FUTURE_DATE, baseFields());
    await db.update(plannedWorkouts).set({ status: 'completed' }).where(eq(plannedWorkouts.id, workout.id));

    const response = await POST(deleteRequest(workout.id), routeParams(workout.id));

    expect(response.status).toBe(400);
    const [stored] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, workout.id));
    expect(stored.status).toBe('completed');
  });
});
