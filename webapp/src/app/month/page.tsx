import { redirect } from 'next/navigation';
import type { PlannedWorkout, RaceEvent } from '@/db/schema';
import { getCurrentUserId } from '@/lib/session';
import {
  firstOfMonth,
  formatDateParam,
  getPlannedInRange,
  getRaceEventsInRange,
  mondayOf,
  monthGridRange,
  parseDateParam,
} from '@/lib/plan';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function summarizeStatus(dayWorkouts: PlannedWorkout[]): string[] {
  const labels: string[] = [];
  for (const workout of dayWorkouts) {
    if (workout.status === 'completed') labels.push('completed');
    else if (workout.status === 'planned' || workout.status === 'accepted') labels.push('planned');
    else if (workout.status === 'pending_review') labels.push('suggested');
    else if (workout.status === 'skipped') labels.push('skipped');
    // rejected/superseded rows are not rendered — the workout that replaced them is.
  }
  return labels;
}

export default async function MonthPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect('/sign-in');
  }

  const sp = await searchParams;
  const monthParam = typeof sp.month === 'string' ? sp.month : undefined;
  const requested = monthParam ? parseDateParam(monthParam) : null;
  const monthStart = firstOfMonth(requested ?? new Date());
  const { gridStart, gridEnd } = monthGridRange(monthStart);

  const [workouts, races] = await Promise.all([
    getPlannedInRange(userId, gridStart, gridEnd),
    getRaceEventsInRange(userId, gridStart, gridEnd),
  ]);

  const workoutsByDate = new Map<string, PlannedWorkout[]>();
  for (const workout of workouts) {
    const key = formatDateParam(workout.date);
    const bucket = workoutsByDate.get(key);
    if (bucket) bucket.push(workout);
    else workoutsByDate.set(key, [workout]);
  }

  const racesByDate = new Map<string, RaceEvent[]>();
  for (const race of races) {
    const key = formatDateParam(race.date);
    const bucket = racesByDate.get(key);
    if (bucket) bucket.push(race);
    else racesByDate.set(key, [race]);
  }

  const totalDays = Math.round((gridEnd.getTime() - gridStart.getTime()) / (24 * 60 * 60 * 1000));
  const days = Array.from({ length: totalDays }, (_, index) => {
    const day = new Date(gridStart);
    day.setUTCDate(day.getUTCDate() + index);
    return day;
  });
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const previousMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 1, 1));
  const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const currentMonthStart = firstOfMonth(new Date());
  const weekViewHref = `/?week=${formatDateParam(mondayOf(monthStart))}`;

  return (
    <main>
      <nav>
        <a href={`/month?month=${formatDateParam(previousMonth)}`}>‹ Previous</a>{' '}
        <a href={`/month?month=${formatDateParam(currentMonthStart)}`}>Today</a>{' '}
        <a href={`/month?month=${formatDateParam(nextMonth)}`}>Next ›</a>{' '}
        <a href={weekViewHref}>Week view</a>
      </nav>
      <h1>
        {monthStart.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} {monthStart.getUTCFullYear()}
      </h1>
      <table>
        <thead>
          <tr>
            {DAY_LABELS.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={formatDateParam(week[0])}>
              {week.map((day) => {
                const key = formatDateParam(day);
                const inMonth =
                  day.getUTCMonth() === monthStart.getUTCMonth() &&
                  day.getUTCFullYear() === monthStart.getUTCFullYear();

                if (!inMonth) {
                  return (
                    <td key={key} style={{ color: '#999' }}>
                      {key}
                    </td>
                  );
                }

                const dayWorkouts = workoutsByDate.get(key) ?? [];
                const dayRaces = racesByDate.get(key) ?? [];
                const statusLabels = summarizeStatus(dayWorkouts);

                return (
                  <td key={key}>
                    <a href={`/?week=${formatDateParam(mondayOf(day))}`}>{key}</a>
                    {statusLabels.length > 0 && (
                      <ul>
                        {statusLabels.map((label, index) => (
                          <li key={index}>{label}</li>
                        ))}
                      </ul>
                    )}
                    {dayRaces.map((race) => (
                      <div key={race.id}>{race.name}</div>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
