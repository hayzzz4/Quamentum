import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users, type User } from '@/db/schema';
import { encrypt, decrypt } from './crypto';

export interface StravaAthleteInfo {
  id: number;
  firstname: string;
  lastname: string;
  timezone: string | null;
}

export interface StravaTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

function parseIanaTimezone(stravaTimezone: string | null): string {
  if (!stravaTimezone) return 'UTC';
  const parts = stravaTimezone.split(') ');
  return parts.length === 2 ? parts[1] : 'UTC';
}

function encryptionKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not set');
  }
  return Buffer.from(key, 'hex');
}

export async function upsertUserFromStrava(athlete: StravaAthleteInfo, tokens: StravaTokenSet) {
  const key = encryptionKey();
  const name = `${athlete.firstname} ${athlete.lastname}`.trim();
  const encryptedAccessToken = encrypt(tokens.accessToken, key);
  const encryptedRefreshToken = encrypt(tokens.refreshToken, key);

  const [user] = await db
    .insert(users)
    .values({
      stravaAthleteId: athlete.id,
      name,
      timezone: parseIanaTimezone(athlete.timezone),
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      expiresAt: tokens.expiresAt,
      connectionStatus: 'connected',
    })
    .onConflictDoUpdate({
      target: users.stravaAthleteId,
      set: {
        name,
        timezone: parseIanaTimezone(athlete.timezone),
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt: tokens.expiresAt,
        connectionStatus: 'connected',
        updatedAt: new Date(),
      },
    })
    .returning();

  return user;
}

export async function findUserByStravaAthleteId(stravaAthleteId: number): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.stravaAthleteId, stravaAthleteId));
  return user ?? null;
}

export async function getConnectedUsers(): Promise<User[]> {
  return db.select().from(users).where(eq(users.connectionStatus, 'connected'));
}

export function decryptUserTokens(
  user: Pick<User, 'accessToken' | 'refreshToken'>,
): { accessToken: string; refreshToken: string } {
  const key = encryptionKey();
  return {
    accessToken: decrypt(user.accessToken, key),
    refreshToken: decrypt(user.refreshToken, key),
  };
}

export async function updateUserTokens(userId: string, tokens: StravaTokenSet): Promise<void> {
  const key = encryptionKey();
  await db
    .update(users)
    .set({
      accessToken: encrypt(tokens.accessToken, key),
      refreshToken: encrypt(tokens.refreshToken, key),
      expiresAt: tokens.expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function markUserDisconnected(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ connectionStatus: 'disconnected', updatedAt: new Date() })
    .where(eq(users.id, userId));
}
