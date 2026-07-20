import { notFound, redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/session';
import { getDayPlanned, isEditableDate, parseDateParam } from '@/lib/plan';

export default async function PlanDayPage({ params }: { params: Promise<{ date: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect('/sign-in');
  }

  const { date: dateParam } = await params;
  const date = parseDateParam(dateParam);
  if (!date) {
    notFound();
  }

  const workouts = await getDayPlanned(userId, date);
  const editable = isEditableDate(date);

  return (
    <main>
      <p>
        <a href="/">‹ Back to week</a>
      </p>
      <h1>{dateParam}</h1>
      {workouts.length === 0 && <p>No workouts planned.</p>}
      <ul>
        {workouts.map((workout) => (
          <li key={workout.id}>
            {workout.sport} · {workout.workoutType}
            {editable && (
              <>
                {' '}
                <a href={`/plan/${dateParam}/${workout.id}/edit`}>Edit</a>{' '}
                <form action={`/api/plan/workouts/${workout.id}/delete`} method="post" style={{ display: 'inline' }}>
                  <button type="submit">Delete</button>
                </form>
              </>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <p>
          <a href={`/plan/${dateParam}/new`}>Add workout</a>
        </p>
      )}
    </main>
  );
}
