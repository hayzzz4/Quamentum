const STRAVA_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_SCOPES = 'read,activity:read_all';

export function getStravaAuthorizeUrl(state: string): string {
  const url = new URL(STRAVA_AUTHORIZE_URL);
  url.searchParams.set('client_id', process.env.STRAVA_CLIENT_ID!);
  url.searchParams.set('redirect_uri', process.env.STRAVA_REDIRECT_URI!);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('approval_prompt', 'auto');
  url.searchParams.set('scope', STRAVA_SCOPES);
  url.searchParams.set('state', state);
  return url.toString();
}

export interface StravaAthlete {
  id: number;
  firstname: string;
  lastname: string;
  timezone: string | null;
}

export interface StravaTokenResponse {
  token_type: string;
  expires_at: number;
  expires_in: number;
  refresh_token: string;
  access_token: string;
  athlete?: StravaAthlete;
}

async function postToStrava(body: Record<string, string>): Promise<StravaTokenResponse> {
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      ...body,
    }),
  });
  if (!response.ok) {
    throw new Error(`Strava token endpoint responded with ${response.status}`);
  }
  return response.json();
}

export function exchangeCodeForToken(code: string): Promise<StravaTokenResponse> {
  return postToStrava({ code, grant_type: 'authorization_code' });
}

export function refreshStravaToken(refreshToken: string): Promise<StravaTokenResponse> {
  return postToStrava({ refresh_token: refreshToken, grant_type: 'refresh_token' });
}

const STRAVA_API_BASE = 'https://www.strava.com/api/v3';

export class StravaApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'StravaApiError';
  }
}

export interface StravaActivity {
  id: number;
  sport_type: string;
  start_date_local: string;
  moving_time: number;
  distance: number;
  average_heartrate?: number;
  average_speed: number;
  average_watts?: number;
  suffer_score?: number | null;
}

export async function fetchStravaActivity(accessToken: string, activityId: number): Promise<StravaActivity> {
  const response = await fetch(`${STRAVA_API_BASE}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new StravaApiError(response.status, `Strava activity endpoint responded with ${response.status}`);
  }
  return response.json();
}

export interface StravaActivitySummary {
  id: number;
}

export async function fetchStravaActivities(
  accessToken: string,
  afterEpochSeconds: number,
): Promise<StravaActivitySummary[]> {
  const url = new URL(`${STRAVA_API_BASE}/athlete/activities`);
  url.searchParams.set('after', String(afterEpochSeconds));
  url.searchParams.set('per_page', '100');

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new StravaApiError(response.status, `Strava activities endpoint responded with ${response.status}`);
  }
  return response.json();
}
