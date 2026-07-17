import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { activities, plannedWorkouts } from '@/db/schema';
import { findUserByStravaAthleteId } from './users';
import { getActivity } from './strava-client';
import { mapStravaActivityToRow } from './activity-mapping';
import { matchActivity } from './activity-matching';

export async function syncActivity(stravaAthleteId: number, stravaActivityId: number): Promise<void> {
  const user = await findUserByStravaAthleteId(stravaAthleteId);
  if (!user || user.connectionStatus === 'disconnected') return;

  const raw = await getActivity(user, stravaActivityId);
  const row = mapStravaActivityToRow(raw, user.id);

  const [inserted] = await db
    .insert(activities)
    .values(row)
    .onConflictDoNothing({ target: activities.stravaActivityId })
    .returning();

  if (!inserted) return;

  const candidates = await db
    .select()
    .from(plannedWorkouts)
    .where(and(eq(plannedWorkouts.userId, user.id), eq(plannedWorkouts.date, inserted.date)));

  const match = matchActivity(inserted, candidates);
  if (!match) return;

  await db.transaction(async (tx) => {
    await tx.update(activities).set({ matchedPlannedWorkoutId: match.id }).where(eq(activities.id, inserted.id));
    await tx
      .update(plannedWorkouts)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(plannedWorkouts.id, match.id));
  });
}
