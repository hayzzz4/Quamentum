import { notFound, redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/session';
import { formatDateParam, getOwnedPlannedWorkout, isEditableDate } from '@/lib/plan';
import { PlanWorkoutForm } from '@/app/plan/PlanWorkoutForm';

export default async function EditPlannedWorkoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string; workoutId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect('/sign-in');
  }

  const { workoutId } = await params;
  const workout = await getOwnedPlannedWorkout(userId, workoutId);
  if (!workout || !isEditableDate(workout.date)) {
    notFound();
  }

  const dateParam = formatDateParam(workout.date);
  const sp = await searchParams;
  const field = (key: string, fallback: string) => (typeof sp[key] === 'string' ? (sp[key] as string) : fallback);

  return (
    <main>
      <p>
        <a href={`/plan/${dateParam}`}>‹ Back to {dateParam}</a>
      </p>
      <h1>Edit workout — {dateParam}</h1>
      <PlanWorkoutForm
        action={`/api/plan/workouts/${workoutId}/update`}
        hasError={sp.error === 'invalid'}
        values={{
          sport: field('sport', workout.sport),
          workoutType: field('workoutType', workout.workoutType),
          targetDurationMin: field('targetDurationMin', workout.targetDurationMin?.toString() ?? ''),
          targetDistance: field('targetDistance', workout.targetDistance ?? ''),
          targetMetric: field('targetMetric', workout.targetMetric ?? ''),
          targetValue: field('targetValue', workout.targetValue ?? ''),
          notes: field('notes', workout.notes ?? ''),
        }}
        cancelHref={`/plan/${dateParam}`}
        submitLabel="Save changes"
      />
    </main>
  );
}
