import { sealData, unsealData } from 'iron-session';
import { cookies } from 'next/headers';

export interface SessionData {
  userId: string;
}

export const SESSION_COOKIE_NAME = 'quamentum_session';
export const STATE_COOKIE_NAME = 'strava_oauth_state';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function sessionPassword(): string {
  const password = process.env.SESSION_SECRET;
  if (!password) {
    throw new Error('SESSION_SECRET is not set');
  }
  return password;
}

export async function createSessionCookieValue(data: SessionData): Promise<string> {
  return sealData(data, { password: sessionPassword(), ttl: SESSION_MAX_AGE_SECONDS });
}

export async function readSessionCookieValue(value: string): Promise<SessionData | null> {
  try {
    const data = await unsealData<SessionData>(value, { password: sessionPassword() });
    // iron-session resolves malformed seals to `{}` instead of rejecting.
    return typeof data.userId === 'string' ? data : null;
  } catch {
    return null;
  }
}

export async function getCurrentUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return null;
  const data = await readSessionCookieValue(raw);
  return data?.userId ?? null;
}

export async function setSessionCookie(data: SessionData): Promise<void> {
  const sealed = await createSessionCookieValue(data);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sealed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
