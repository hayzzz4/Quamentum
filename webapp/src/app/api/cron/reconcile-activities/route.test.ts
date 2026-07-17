import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { db } from '@/db/client';
import { activities } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava, markUserDisconnected } from '@/lib/users';
import * as usersModule from '@/lib/users';
import { GET } from './route';

function cronRequest(secret: string | null) {
  const headers: Record<string, string> = {};
  if (secret !== null) headers.authorization = `Bearer ${secret}`;
  return new NextRequest('http://localhost/api/cron/reconcile-activities', { headers });
}

describe('GET /api/cron/reconcile-activities', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    process.env.CRON_SECRET = 'cron-secret';
    await truncateAllTables();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects requests without the correct bearer token', async () => {
    const response = await GET(cronRequest('wrong-secret'));
    expect(response.status).toBe(401);
  });

  it('syncs missing activities for every connected user, skipping disconnected ones', async () => {
    const connected = await upsertUserFromStrava(
      { id: 401, firstname: 'Connected', lastname: 'User', timezone: null },
      { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date() },
    );
    const disconnected = await upsertUserFromStrava(
      { id: 402, firstname: 'Disconnected', lastname: 'User', timezone: null },
      { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date() },
    );
    await markUserDisconnected(disconnected.id);

    const fetchMock = vi.fn((url: string | URL) => {
      if (url.toString().includes('/athlete/activities')) {
        return Promise.resolve({ ok: true, json: async () => [{ id: 900 }] });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: 900,
          sport_type: 'Run',
          start_date_local: '2026-07-10T06:00:00Z',
          moving_time: 1800,
          distance: 5000,
          average_speed: 2.78,
        }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(cronRequest('cron-secret'));

    expect(response.status).toBe(200);
    const stored = await db.select().from(activities).where(eq(activities.userId, connected.id));
    expect(stored).toHaveLength(1);

    const activityListFetches = fetchMock.mock.calls.filter(([url]) => url.toString().includes('/athlete/activities'));
    expect(activityListFetches).toHaveLength(1); // only the connected user was queried
  });

  it('continues past a single user failing and still returns 200', async () => {
    await upsertUserFromStrava(
      { id: 403, firstname: 'Failing', lastname: 'User', timezone: null },
      { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date() },
    );
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Strava is down')));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET(cronRequest('cron-secret'));

    expect(response.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('returns 500 on getConnectedUsers failure with controlled error response', async () => {
    const getConnectedUsersSpy = vi.spyOn(usersModule, 'getConnectedUsers').mockRejectedValue(new Error('Database error'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET(cronRequest('cron-secret'));

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data).toEqual({ error: 'failed to reconcile' });
    expect(consoleErrorSpy).toHaveBeenCalledWith('Reconciliation failed:', expect.any(Error));

    getConnectedUsersSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });
});
