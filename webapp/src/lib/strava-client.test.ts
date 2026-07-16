import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava, findUserByStravaAthleteId } from './users';
import { getActivity, listRecentActivityIds } from './strava-client';

describe('strava-client', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function createUser() {
    return upsertUserFromStrava(
      { id: 111, firstname: 'Test', lastname: 'Athlete', timezone: null },
      { accessToken: 'good-access', refreshToken: 'good-refresh', expiresAt: new Date() },
    );
  }

  it('getActivity returns the activity on a successful first call', async () => {
    const user = await createUser();
    const mockActivity = { id: 1, sport_type: 'Run', start_date_local: '2026-07-10T06:00:00Z', moving_time: 100, distance: 100, average_speed: 1 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => mockActivity }));

    const result = await getActivity(user, 1);
    expect(result).toEqual(mockActivity);
  });

  it('getActivity refreshes the token and retries once on a 401', async () => {
    const user = await createUser();
    const mockActivity = { id: 1, sport_type: 'Run', start_date_local: '2026-07-10T06:00:00Z', moving_time: 100, distance: 100, average_speed: 1 };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token_type: 'Bearer',
          expires_at: 1900000000,
          expires_in: 21600,
          access_token: 'refreshed-access',
          refresh_token: 'refreshed-refresh',
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => mockActivity });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getActivity(user, 1);

    expect(result).toEqual(mockActivity);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Third call (the retry) must use the refreshed token.
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer refreshed-access');

    const refreshed = await findUserByStravaAthleteId(111);
    expect(refreshed?.connectionStatus).toBe('connected');
  });

  it('getActivity marks the user disconnected when the refresh itself fails', async () => {
    const user = await createUser();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: false, status: 400 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getActivity(user, 1)).rejects.toThrow();

    const disconnected = await findUserByStravaAthleteId(111);
    expect(disconnected?.connectionStatus).toBe('disconnected');
  });

  it('listRecentActivityIds returns just the ids', async () => {
    const user = await createUser();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 10 }, { id: 20 }] }));

    const result = await listRecentActivityIds(user, new Date('2026-07-08'));
    expect(result).toEqual([10, 20]);
  });
});
