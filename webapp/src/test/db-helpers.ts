import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export async function truncateAllTables(): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      insights, checkins, activities, planned_workouts,
      training_blocks, race_legs, race_events, users
    RESTART IDENTITY CASCADE;
  `);
}
