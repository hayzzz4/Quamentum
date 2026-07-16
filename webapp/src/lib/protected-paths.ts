const PUBLIC_PREFIXES = ['/sign-in', '/api/auth', '/api/strava', '/api/cron', '/_next', '/favicon.ico'];

export function isProtectedPath(pathname: string): boolean {
  return !PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
