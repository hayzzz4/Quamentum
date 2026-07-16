import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava } from './users';
import { decrypt } from './crypto';

describe('upsertUserFromStrava', () => {
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  const athlete = { id: 555, firstname: 'Grace', lastname: 'Hopper', timezone: '(GMT-05:00) America/New_York' };
  const tokens = { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: new Date('2026-08-01T00:00:00Z') };

  it('creates a new user with encrypted tokens and no email', async () => {
    const user = await upsertUserFromStrava(athlete, tokens);

    expect(user.name).toBe('Grace Hopper');
    expect(user.email).toBeNull();
    expect(user.timezone).toBe('America/New_York');
    expect(user.accessToken).not.toBe('access-1');

    const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, 'hex');
    expect(decrypt(user.accessToken, key)).toBe('access-1');
  });

  it('updates tokens on a second login instead of creating a duplicate row', async () => {
    const first = await upsertUserFromStrava(athlete, tokens);
    const second = await upsertUserFromStrava(athlete, {
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      expiresAt: new Date('2026-09-01T00:00:00Z'),
    });

    expect(second.id).toBe(first.id);

    const all = await db.select().from(users).where(eq(users.stravaAthleteId, athlete.id));
    expect(all).toHaveLength(1);

    const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, 'hex');
    expect(decrypt(all[0].accessToken, key)).toBe('access-2');
  });
});
