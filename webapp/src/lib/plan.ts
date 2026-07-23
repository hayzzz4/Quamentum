import { and, eq, gte, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { targetMetricEnum, workoutSportEnum, workoutTypeEnum, type PlannedWorkout, plannedWorkouts, type RaceEvent, raceEvents } from '@/db/schema';

const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateParam(raw: string): Date | null {
  if (!DATE_PARAM_RE.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Guards against JS rolling an invalid calendar date (e.g. Feb 30) into the next month.
  return date.toISOString().slice(0, 10) === raw ? date : null;
}

export function formatDateParam(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUTCDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function mondayOf(date: Date): Date {
  const start = startOfUTCDay(date);
  const weekday = start.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

export function firstOfMonth(date: Date): Date {
  const start = startOfUTCDay(date);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
}

export function monthGridRange(monthStart: Date): { gridStart: Date; gridEnd: Date } {
  const lastOfMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
  const gridStart = mondayOf(monthStart);
  // Exclusive end, matching getWeekPlanned's [start, end) convention: the
  // Monday after the Sunday that closes out the last visible week.
  const gridEnd = mondayOf(lastOfMonth);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + 7);
  return { gridStart, gridEnd };
}

export function isEditableDate(date: Date, now: Date = new Date()): boolean {
  return date.getTime() >= startOfUTCDay(now).getTime();
}

const VALID_SPORTS = new Set<string>(workoutSportEnum.enumValues);
const VALID_WORKOUT_TYPES = new Set<string>(workoutTypeEnum.enumValues);
const VALID_TARGET_METRICS = new Set<string>(targetMetricEnum.enumValues);

export interface WorkoutFormValues {
  sport: string;
  workoutType: string;
  targetDurationMin: string;
  targetDistance: string;
  targetMetric: string;
  targetValue: string;
  notes: string;
}

export interface PlannedWorkoutInput {
  sport: PlannedWorkout['sport'];
  workoutType: PlannedWorkout['workoutType'];
  targetDurationMin: number | null;
  targetDistance: string | null;
  targetMetric: PlannedWorkout['targetMetric'];
  targetValue: string | null;
  notes: string | null;
}

export function targetFieldsValid(targetMetric: string | null, targetValue: string | null): boolean {
  return (targetMetric !== null) === (targetValue !== null);
}

export function readWorkoutFormValues(formData: FormData): WorkoutFormValues {
  return {
    sport: String(formData.get('sport') ?? ''),
    workoutType: String(formData.get('workoutType') ?? ''),
    targetDurationMin: String(formData.get('targetDurationMin') ?? ''),
    targetDistance: String(formData.get('targetDistance') ?? ''),
    targetMetric: String(formData.get('targetMetric') ?? ''),
    targetValue: String(formData.get('targetValue') ?? ''),
    notes: String(formData.get('notes') ?? ''),
  };
}

export function parseWorkoutForm(values: WorkoutFormValues): PlannedWorkoutInput | null {
  if (!VALID_SPORTS.has(values.sport)) return null;
  if (!VALID_WORKOUT_TYPES.has(values.workoutType)) return null;

  const targetMetric = values.targetMetric.trim() || null;
  const targetValue = values.targetValue.trim() || null;
  if (targetMetric !== null && !VALID_TARGET_METRICS.has(targetMetric)) return null;
  if (!targetFieldsValid(targetMetric, targetValue)) return null;

  let targetDurationMin: number | null = null;
  if (values.targetDurationMin.trim()) {
    const parsed = Number(values.targetDurationMin);
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    targetDurationMin = parsed;
  }

  let targetDistance: string | null = null;
  if (values.targetDistance.trim()) {
    const parsed = Number(values.targetDistance);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    targetDistance = parsed.toFixed(2);
  }

  return {
    sport: values.sport as PlannedWorkout['sport'],
    workoutType: values.workoutType as PlannedWorkout['workoutType'],
    targetDurationMin,
    targetDistance,
    targetMetric: targetMetric as PlannedWorkout['targetMetric'],
    targetValue,
    notes: values.notes.trim() || null,
  };
}

export async function getPlannedInRange(userId: string, start: Date, end: Date): Promise<PlannedWorkout[]> {
  return db
    .select()
    .from(plannedWorkouts)
    .where(
      and(
        eq(plannedWorkouts.userId, userId),
        gte(plannedWorkouts.date, start),
        lt(plannedWorkouts.date, end),
      ),
    )
    .orderBy(plannedWorkouts.createdAt);
}

export async function getWeekPlanned(userId: string, weekStart: Date): Promise<PlannedWorkout[]> {
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  return getPlannedInRange(userId, weekStart, weekEnd);
}

export async function getRaceEventsInRange(userId: string, start: Date, end: Date): Promise<RaceEvent[]> {
  return db
    .select()
    .from(raceEvents)
    .where(and(eq(raceEvents.userId, userId), gte(raceEvents.date, start), lt(raceEvents.date, end)))
    .orderBy(raceEvents.date);
}

export async function getDayPlanned(userId: string, date: Date): Promise<PlannedWorkout[]> {
  return db
    .select()
    .from(plannedWorkouts)
    .where(and(eq(plannedWorkouts.userId, userId), eq(plannedWorkouts.date, date)))
    .orderBy(plannedWorkouts.createdAt);
}

export async function createPlannedWorkout(
  userId: string,
  date: Date,
  fields: PlannedWorkoutInput,
): Promise<PlannedWorkout> {
  const [inserted] = await db
    .insert(plannedWorkouts)
    .values({ userId, date, source: 'user', status: 'planned', ...fields })
    .returning();
  return inserted;
}

export async function getOwnedPlannedWorkout(userId: string, workoutId: string): Promise<PlannedWorkout | null> {
  const [workout] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, workoutId));
  if (!workout || workout.userId !== userId) return null;
  return workout;
}

export async function updatePlannedWorkout(
  userId: string,
  workoutId: string,
  fields: PlannedWorkoutInput,
): Promise<PlannedWorkout | null> {
  const [updated] = await db
    .update(plannedWorkouts)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(plannedWorkouts.id, workoutId), eq(plannedWorkouts.userId, userId)))
    .returning();
  return updated ?? null;
}

export type DeletePlannedWorkoutResult = 'deleted' | 'not_found' | 'not_deletable';

export async function deletePlannedWorkout(userId: string, workoutId: string): Promise<DeletePlannedWorkoutResult> {
  const [existing] = await db
    .select()
    .from(plannedWorkouts)
    .where(and(eq(plannedWorkouts.id, workoutId), eq(plannedWorkouts.userId, userId)));
  if (!existing) return 'not_found';
  if (existing.status === 'completed') return 'not_deletable';
  await db.delete(plannedWorkouts).where(eq(plannedWorkouts.id, workoutId));
  return 'deleted';
}
