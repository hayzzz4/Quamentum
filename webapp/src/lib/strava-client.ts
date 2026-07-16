import type { User } from '@/db/schema';
import { decryptUserTokens, markUserDisconnected, updateUserTokens } from './users';
import {
  StravaApiError,
  fetchStravaActivities,
  fetchStravaActivity,
  refreshStravaToken,
  type StravaActivity,
} from './strava';

async function withTokenRefresh<T>(user: User, call: (accessToken: string) => Promise<T>): Promise<T> {
  const { accessToken, refreshToken } = decryptUserTokens(user);

  try {
    return await call(accessToken);
  } catch (error) {
    if (!(error instanceof StravaApiError) || error.status !== 401) {
      throw error;
    }

    let refreshed;
    try {
      refreshed = await refreshStravaToken(refreshToken);
    } catch (refreshError) {
      await markUserDisconnected(user.id);
      throw refreshError;
    }

    await updateUserTokens(user.id, {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: new Date(refreshed.expires_at * 1000),
    });

    return call(refreshed.access_token);
  }
}

export function getActivity(user: User, stravaActivityId: number): Promise<StravaActivity> {
  return withTokenRefresh(user, (accessToken) => fetchStravaActivity(accessToken, stravaActivityId));
}

export function listRecentActivityIds(user: User, after: Date): Promise<number[]> {
  return withTokenRefresh(user, async (accessToken) => {
    const summaries = await fetchStravaActivities(accessToken, Math.floor(after.getTime() / 1000));
    return summaries.map((summary) => summary.id);
  });
}
