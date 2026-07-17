import type { Activity, PlannedWorkout } from '@/db/schema';

export function matchActivity(
  activity: Pick<Activity, 'date' | 'sport'>,
  candidates: PlannedWorkout[],
): PlannedWorkout | null {
  if (activity.sport === 'other') return null;

  const eligible = candidates.filter(
    (workout) =>
      workout.date.getTime() === activity.date.getTime() &&
      workout.sport === activity.sport &&
      workout.status === 'planned',
  );

  if (eligible.length === 0) return null;

  return eligible.reduce((latest, workout) => (workout.createdAt > latest.createdAt ? workout : latest));
}
