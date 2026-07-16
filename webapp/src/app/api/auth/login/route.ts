import { NextResponse } from 'next/server';
import { getStravaAuthorizeUrl } from '@/lib/strava';
import { generateOAuthState } from '@/lib/oauth-state';

const STATE_COOKIE_NAME = 'strava_oauth_state';

export async function GET() {
  const state = generateOAuthState();
  const response = NextResponse.redirect(getStravaAuthorizeUrl(state));
  response.cookies.set(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 10,
  });
  return response;
}
