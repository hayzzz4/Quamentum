import { NextRequest, NextResponse } from 'next/server';
import { unsealData } from 'iron-session';
import { isProtectedPath } from '@/lib/protected-paths';
import { SESSION_COOKIE_NAME } from '@/lib/session';

export async function proxy(request: NextRequest) {
  if (!isProtectedPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = raw
    ? await unsealData<{ userId: string }>(raw, { password: process.env.SESSION_SECRET! }).catch(() => null)
    : null;

  if (!session?.userId) {
    return NextResponse.redirect(new URL('/sign-in', request.url), 303);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
