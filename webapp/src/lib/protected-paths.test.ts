import { describe, expect, it } from 'vitest';
import { isProtectedPath } from './protected-paths';

describe('isProtectedPath', () => {
  it('protects the home page', () => {
    expect(isProtectedPath('/')).toBe(true);
  });

  it('protects onboarding', () => {
    expect(isProtectedPath('/onboarding/email')).toBe(true);
  });

  it('does not protect sign-in', () => {
    expect(isProtectedPath('/sign-in')).toBe(false);
  });

  it('does not protect auth API routes', () => {
    expect(isProtectedPath('/api/auth/login')).toBe(false);
    expect(isProtectedPath('/api/auth/callback')).toBe(false);
  });

  it('does not protect Next.js internals', () => {
    expect(isProtectedPath('/_next/static/chunk.js')).toBe(false);
    expect(isProtectedPath('/favicon.ico')).toBe(false);
  });

  it('does not protect the Strava webhook route', () => {
    expect(isProtectedPath('/api/strava/webhook')).toBe(false);
  });

  it('does not protect cron routes', () => {
    expect(isProtectedPath('/api/cron/reconcile-activities')).toBe(false);
  });
});
