import { notFound, redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/session';
import { isEditableDate, parseDateParam } from '@/lib/plan';
import { PlanWorkoutForm } from '@/app/plan/PlanWorkoutForm';

export default async function NewPlannedWorkoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect('/sign-in');
  }

  const { date: dateParam } = await params;
  const date = parseDateParam(dateParam);
  if (!date || !isEditableDate(date)) {
    notFound();
  }

  const sp = await searchParams;
  const field = (key: string) => (typeof sp[key] === 'string' ? (sp[key] as string) : '');

  return (
    <main>
      <p>
        <a href={`/plan/${dateParam}`}>‹ Back to {dateParam}</a>
      </p>
      <h1>Add workout — {dateParam}</h1>
      <PlanWorkoutForm
        action="/api/plan/workouts"
        dateFieldValue={dateParam}
        hasError={sp.error === 'invalid'}
        values={{
          sport: field('sport'),
          workoutType: field('workoutType'),
          targetDurationMin: field('targetDurationMin'),
          targetDistance: field('targetDistance'),
          targetMetric: field('targetMetric'),
          targetValue: field('targetValue'),
          notes: field('notes'),
        }}
        cancelHref={`/plan/${dateParam}`}
        submitLabel="Add workout"
      />
    </main>
  );
}
