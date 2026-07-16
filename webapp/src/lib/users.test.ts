import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';
import {
  upsertUserFromStrava,
  findUserByStravaAthleteId,
  getConnectedUsers,
  decryptUserTokens,
  updateUserTokens,
  markUserDisconnected,
} from './users';
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

describe('findUserByStravaAthleteId', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it('finds a user by their Strava athlete id', async () => {
    const created = await upsertUserFromStrava(
      { id: 4242, firstname: 'Ada', lastname: 'Lovelace', timezone: null },
      { accessToken: 'a', refreshToken: 'r', expiresAt: new Date() },
    );

    const found = await findUserByStravaAthleteId(4242);
    expect(found?.id).toBe(created.id);
  });

  it('returns null when no user matches', async () => {
    expect(await findUserByStravaAthleteId(999999)).toBeNull();
  });
});

describe('getConnectedUsers', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it('returns only users with connection_status="connected"', async () => {
    const connected = await upsertUserFromStrava(
      { id: 1, firstname: 'Connected', lastname: 'User', timezone: null },
      { accessToken: 'a', refreshToken: 'r', expiresAt: new Date() },
    );
    const disconnected = await upsertUserFromStrava(
      { id: 2, firstname: 'Disconnected', lastname: 'User', timezone: null },
      { accessToken: 'a', refreshToken: 'r', expiresAt: new Date() },
    );
    await markUserDisconnected(disconnected.id);

    const result = await getConnectedUsers();
    expect(result.map((u) => u.id)).toEqual([connected.id]);
  });
});

describe('decryptUserTokens / updateUserTokens', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it('round-trips tokens through encrypt/decrypt', async () => {
    const user = await upsertUserFromStrava(
      { id: 3, firstname: 'Grace', lastname: 'Hopper', timezone: null },
      { accessToken: 'original-access', refreshToken: 'original-refresh', expiresAt: new Date() },
    );

    expect(decryptUserTokens(user)).toEqual({
      accessToken: 'original-access',
      refreshToken: 'original-refresh',
    });

    await updateUserTokens(user.id, {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    });

    const refreshed = await findUserByStravaAthleteId(3);
    expect(decryptUserTokens(refreshed!)).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
  });
});

describe('markUserDisconnected', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it('sets connection_status to disconnected', async () => {
    const user = await upsertUserFromStrava(
      { id: 5, firstname: 'Test', lastname: 'User', timezone: null },
      { accessToken: 'a', refreshToken: 'r', expiresAt: new Date() },
    );

    await markUserDisconnected(user.id);

    const found = await findUserByStravaAthleteId(5);
    expect(found?.connectionStatus).toBe('disconnected');
  });
});
