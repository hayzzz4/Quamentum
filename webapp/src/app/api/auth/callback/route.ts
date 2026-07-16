import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForToken } from '@/lib/strava';
import { upsertUserFromStrava } from '@/lib/users';
import { setSessionCookie } from '@/lib/session';

const STATE_COOKIE_NAME = 'strava_oauth_state';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const cookieState = request.cookies.get(STATE_COOKIE_NAME)?.value;

  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(new URL('/sign-in?error=oauth_state', request.url));
  }

  const tokenResponse = await exchangeCodeForToken(code);
  if (!tokenResponse.athlete) {
    return NextResponse.redirect(new URL('/sign-in?error=no_athlete', request.url));
  }

  const user = await upsertUserFromStrava(
    {
      id: tokenResponse.athlete.id,
      firstname: tokenResponse.athlete.firstname,
      lastname: tokenResponse.athlete.lastname,
      timezone: tokenResponse.athlete.timezone,
    },
    {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: new Date(tokenResponse.expires_at * 1000),
    },
  );

  await setSessionCookie({ userId: user.id });

  const destination = user.email ? '/' : '/onboarding/email';
  const response = NextResponse.redirect(new URL(destination, request.url));
  response.cookies.delete(STATE_COOKIE_NAME);
  return response;
}
