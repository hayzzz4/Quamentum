import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { getCurrentUserId } from '@/lib/session';
import { firstOfMonth, formatDateParam, getWeekPlanned, isEditableDate, mondayOf, parseDateParam } from '@/lib/plan';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect('/sign-in');
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    redirect('/sign-in');
  }

  const sp = await searchParams;
  const weekParam = typeof sp.week === 'string' ? sp.week : undefined;
  const requested = weekParam ? parseDateParam(weekParam) : null;
  const weekStart = mondayOf(requested ?? new Date());

  const workouts = await getWeekPlanned(userId, weekStart);
  const byDate = new Map<string, typeof workouts>();
  for (const workout of workouts) {
    const key = formatDateParam(workout.date);
    const bucket = byDate.get(key);
    if (bucket) bucket.push(workout);
    else byDate.set(key, [workout]);
  }

  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setUTCDate(day.getUTCDate() + index);
    return day;
  });

  const previousWeek = new Date(weekStart);
  previousWeek.setUTCDate(previousWeek.getUTCDate() - 7);
  const nextWeek = new Date(weekStart);
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  const currentWeekStart = mondayOf(new Date());
  const monthViewHref = `/month?month=${formatDateParam(firstOfMonth(weekStart))}`;

  return (
    <main>
      {user.connectionStatus === 'disconnected' && (
        <p role="alert">
          Your Strava connection needs to be renewed — activities won&apos;t sync until you{' '}
          <a href="/api/auth/login">reconnect</a>.
        </p>
      )}
      <h1>Welcome, {user.name}</h1>
      <nav>
        <a href={`/?week=${formatDateParam(previousWeek)}`}>‹ Previous</a>{' '}
        <a href={`/?week=${formatDateParam(currentWeekStart)}`}>Today</a>{' '}
        <a href={`/?week=${formatDateParam(nextWeek)}`}>Next ›</a>{' '}
        <a href={monthViewHref}>Month view</a>{' '}
        <a href="/checkin">Check in</a>
      </nav>
      <table>
        <thead>
          <tr>
            {DAY_LABELS.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {days.map((day) => {
              const key = formatDateParam(day);
              const dayWorkouts = byDate.get(key) ?? [];
              const editable = isEditableDate(day);
              return (
                <td key={key}>
                  <a href={`/plan/${key}`}>{key}</a>
                  {dayWorkouts.length > 0 ? (
                    <ul>
                      {dayWorkouts.map((workout) => (
                        <li key={workout.id}>
                          {workout.sport} · {workout.workoutType}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    editable && (
                      <p>
                        <a href={`/plan/${key}/new`}>Add workout</a>
                      </p>
                    )
                  )}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      <form action="/api/auth/logout" method="post">
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
