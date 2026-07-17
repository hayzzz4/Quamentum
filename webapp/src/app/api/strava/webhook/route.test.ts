import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { db } from '@/db/client';
import { activities } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava } from '@/lib/users';
import { GET, POST } from './route';

describe('GET /api/strava/webhook (subscription verification)', () => {
  beforeEach(() => {
    process.env.STRAVA_WEBHOOK_VERIFY_TOKEN = 'verify-me';
  });

  it('echoes the challenge when the verify token matches', async () => {
    const url = 'http://localhost/api/strava/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc123';
    const response = await GET(new NextRequest(url));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ 'hub.challenge': 'abc123' });
  });

  it('rejects a mismatched verify token', async () => {
    const url = 'http://localhost/api/strava/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123';
    const response = await GET(new NextRequest(url));

    expect(response.status).toBe(403);
  });
});

describe('POST /api/strava/webhook (activity events)', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function postRequest(body: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/strava/webhook', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
  }

  it('syncs the activity on a create event and returns 200', async () => {
    const user = await upsertUserFromStrava(
      { id: 301, firstname: 'Test', lastname: 'Athlete', timezone: null },
      { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date() },
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 900,
        sport_type: 'Run',
        start_date_local: '2026-07-10T06:00:00Z',
        moving_time: 1800,
        distance: 5000,
        average_speed: 2.78,
      }),
    }));

    const response = await POST(
      postRequest({ object_type: 'activity', aspect_type: 'create', object_id: 900, owner_id: 301 }),
    );

    expect(response.status).toBe(200);
    const [stored] = await db.select().from(activities).where(eq(activities.userId, user.id));
    expect(stored.stravaActivityId).toBe(900);
  });

  it('does not sync update/delete events, and still returns 200', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      postRequest({ object_type: 'activity', aspect_type: 'update', object_id: 900, owner_id: 301 }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 200 even when sync processing fails', async () => {
    await upsertUserFromStrava(
      { id: 302, firstname: 'Test', lastname: 'Athlete', timezone: null },
      { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date() },
    );
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(
      postRequest({ object_type: 'activity', aspect_type: 'create', object_id: 900, owner_id: 302 }),
    );

    expect(response.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
