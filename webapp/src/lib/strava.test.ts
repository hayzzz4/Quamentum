import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStravaAuthorizeUrl, exchangeCodeForToken, refreshStravaToken, fetchStravaActivity, fetchStravaActivities } from './strava';

describe('getStravaAuthorizeUrl', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('builds the Strava authorize URL with the right params', () => {
    process.env.STRAVA_CLIENT_ID = 'client-123';
    process.env.STRAVA_REDIRECT_URI = 'http://localhost:3000/api/auth/callback';

    const url = new URL(getStravaAuthorizeUrl('state-abc'));

    expect(url.origin + url.pathname).toBe('https://www.strava.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('read,activity:read_all');
    expect(url.searchParams.get('state')).toBe('state-abc');
  });
});

describe('exchangeCodeForToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the code to the Strava token endpoint and returns the parsed response', async () => {
    const mockResponse = {
      token_type: 'Bearer',
      expires_at: 1900000000,
      expires_in: 21600,
      refresh_token: 'refresh-abc',
      access_token: 'access-abc',
      athlete: { id: 42, firstname: 'Ada', lastname: 'Lovelace', timezone: '(GMT+00:00) Europe/London' },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await exchangeCodeForToken('auth-code-xyz');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.strava.com/oauth/token',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.code).toBe('auth-code-xyz');
    expect(body.grant_type).toBe('authorization_code');
    expect(result).toEqual(mockResponse);
  });

  it('throws when Strava responds with a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400 }));
    await expect(exchangeCodeForToken('bad-code')).rejects.toThrow(/400/);
  });
});

describe('refreshStravaToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the refresh token with the right grant_type', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token_type: 'Bearer',
        expires_at: 1900000000,
        expires_in: 21600,
        refresh_token: 'new-refresh',
        access_token: 'new-access',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await refreshStravaToken('old-refresh-token');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.refresh_token).toBe('old-refresh-token');
    expect(body.grant_type).toBe('refresh_token');
  });
});

describe('fetchStravaActivity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches an activity by id with a bearer token', async () => {
    const mockActivity = { id: 555, sport_type: 'Run', start_date_local: '2026-07-10T06:00:00Z', moving_time: 1800, distance: 5000, average_speed: 2.78 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => mockActivity });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchStravaActivity('token-abc', 555);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.strava.com/api/v3/activities/555',
      expect.objectContaining({ headers: { Authorization: 'Bearer token-abc' } }),
    );
    expect(result).toEqual(mockActivity);
  });

  it('throws a StravaApiError with the response status on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(fetchStravaActivity('token-abc', 555)).rejects.toMatchObject({ status: 401 });
  });
});

describe('fetchStravaActivities', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists activities after a given timestamp', async () => {
    const mockList = [{ id: 1 }, { id: 2 }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => mockList });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchStravaActivities('token-abc', 1700000000);

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.origin + calledUrl.pathname).toBe('https://www.strava.com/api/v3/athlete/activities');
    expect(calledUrl.searchParams.get('after')).toBe('1700000000');
    expect(result).toEqual(mockList);
  });

  it('throws a StravaApiError on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchStravaActivities('token-abc', 1700000000)).rejects.toMatchObject({ status: 500 });
  });
});
