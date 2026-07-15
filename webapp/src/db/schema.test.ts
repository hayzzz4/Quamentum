import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';

describe('schema: users table', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it('inserts and reads back a user with a null email', async () => {
    const [inserted] = await db
      .insert(users)
      .values({
        stravaAthleteId: 12345,
        name: 'Ada Lovelace',
        timezone: 'Europe/London',
        accessToken: 'enc-access',
        refreshToken: 'enc-refresh',
        expiresAt: new Date(),
      })
      .returning();

    const [found] = await db.select().from(users).where(eq(users.id, inserted.id));
    expect(found.name).toBe('Ada Lovelace');
    expect(found.email).toBeNull();
  });

  it('rejects a duplicate strava_athlete_id', async () => {
    const values = {
      stravaAthleteId: 999,
      name: 'Athlete One',
      timezone: 'UTC',
      accessToken: 'a',
      refreshToken: 'b',
      expiresAt: new Date(),
    };
    await db.insert(users).values(values);
    await expect(db.insert(users).values(values)).rejects.toThrow();
  });
});
