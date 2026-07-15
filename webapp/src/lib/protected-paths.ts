const PUBLIC_PREFIXES = ['/sign-in', '/api/auth', '/_next', '/favicon.ico'];

export function isProtectedPath(pathname: string): boolean {
  return !PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
