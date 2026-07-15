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
