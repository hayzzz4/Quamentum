import { db } from '@/db/client';
import { users } from '@/db/schema';
import { encrypt } from './crypto';

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
