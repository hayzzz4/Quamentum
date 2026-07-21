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

function formValues(overrides: Record<string, string> = {}): Record<string, string> {
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

function formRequest(id: string, fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return new NextRequest(`http://localhost/api/plan/workouts/${id}/update`, { method: 'POST', body: formData });
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

describe('POST /api/plan/workouts/[id]/update', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates an owned workout and redirects to the day page', async () => {
    const user = await createTestUser(801);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);
    const workout = await createPlannedWorkout(user.id, FUTURE_DATE, baseFields());

    const response = await POST(formRequest(workout.id, formValues({ workoutType: 'tempo' })), routeParams(workout.id));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/plan/2099-06-01');
    const [stored] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, workout.id));
    expect(stored.workoutType).toBe('tempo');
  });

  it('returns 404 for a workout owned by another user', async () => {
    const owner = await createTestUser(802);
    const other = await createTestUser(803);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(other.id);
    const workout = await createPlannedWorkout(owner.id, FUTURE_DATE, baseFields());

    const response = await POST(formRequest(workout.id, formValues()), routeParams(workout.id));
    expect(response.status).toBe(404);
  });

  it('returns 404 for a nonexistent workout id', async () => {
    const user = await createTestUser(804);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);
    const missingId = '00000000-0000-0000-0000-000000000000';

    const response = await POST(formRequest(missingId, formValues()), routeParams(missingId));
    expect(response.status).toBe(404);
  });

  it('rejects editing a past-dated workout with a 400', async () => {
    const user = await createTestUser(805);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);
    const workout = await createPlannedWorkout(user.id, PAST_DATE, baseFields());

    const response = await POST(formRequest(workout.id, formValues()), routeParams(workout.id));
    expect(response.status).toBe(400);
  });

  it('rejects editing a completed workout with a 400', async () => {
    const user = await createTestUser(807);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);
    const workout = await createPlannedWorkout(user.id, FUTURE_DATE, baseFields());
    await db.update(plannedWorkouts).set({ status: 'completed' }).where(eq(plannedWorkouts.id, workout.id));

    const response = await POST(formRequest(workout.id, formValues({ workoutType: 'tempo' })), routeParams(workout.id));

    expect(response.status).toBe(400);
    const [stored] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, workout.id));
    expect(stored.workoutType).not.toBe('tempo');
  });

  it('redirects back to the edit form with an error when fields are invalid', async () => {
    const user = await createTestUser(806);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);
    const workout = await createPlannedWorkout(user.id, FUTURE_DATE, baseFields());

    const response = await POST(
      formRequest(workout.id, formValues({ targetMetric: 'pace' })),
      routeParams(workout.id),
    );

    expect(response.status).toBe(303);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain(`/plan/2099-06-01/${workout.id}/edit`);
    expect(location).toContain('error=invalid');
  });
});
