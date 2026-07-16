# Strava Activity Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync completed Strava activities into Quamentum for each connected athlete — via a real-time webhook backed by a daily reconciliation cron — and match them to that day's planned workout, so later plans (AI insights, calendar UI) have real activity data to build on.

**Architecture:** Extends the Foundation & Auth webapp with a Strava webhook receiver and a Vercel Cron reconciliation route, both funneling through one shared sync core (`lib/activity-sync.ts`) that fetches activity detail via an auth-refreshing Strava client, maps it into the `activities` table, and matches it to a same-day/same-sport `planned_workouts` row.

**Tech Stack:** Next.js (App Router route handlers), Drizzle ORM, Vitest against a real Postgres instance (existing pattern), Vercel Cron (`vercel.json`).

**Design doc:** `docs/superpowers/specs/2026-07-16-strava-activity-sync-design.md` — read it first for the full flow and error-handling rationale; this plan implements it task by task.

**Out of scope for this plan:** insight/suggestion generation (a later plan consumes what this plan stores), Strava webhook *subscription creation* (the one-time `POST` to Strava's API registering our callback URL — a manual step once deployed to a public URL; this plan builds the receiver Strava calls, not the registration call we'd make to Strava), `update`/`delete` webhook event handling beyond acknowledging them, and any UI beyond the one-line reconnect banner.

## Global Constraints

- Stack is Next.js (TypeScript) — route handlers only, no separate service.
- Database is Postgres via Drizzle ORM — `db/schema.ts` remains the single source of truth; this plan only adds an enum value, no new tables.
- Strava `access_token`/`refresh_token` stay encrypted at rest (AES-256-GCM via `lib/crypto.ts`) — every place a token is read or written goes through `lib/users.ts`'s helpers, never raw column access.
- No feature in this plan may block on real Strava/Vercel credentials for automated tests — webhook and cron paths are covered by unit/integration tests with a mocked Strava API (`vi.stubGlobal('fetch', ...)`) against the real local Postgres test database; confirmed for real only in this plan's final manual task.
- Webhook and cron routes authenticate the *caller* (Strava's verify token; Vercel's `CRON_SECRET` bearer header) instead of the app's session cookie — they must be exempted from `proxy.ts`'s session-protection matcher.

---

## File Structure

```
webapp/
  vercel.json                              (new)
  .env.example                             (modify)
  src/
    db/
      schema.ts                            (modify)
    lib/
      strava.ts                            (modify)
      strava.test.ts                       (modify)
      strava-client.ts                     (new)
      strava-client.test.ts                (new)
      sport-mapping.ts                     (new)
      sport-mapping.test.ts                (new)
      activity-mapping.ts                  (new)
      activity-mapping.test.ts             (new)
      activity-matching.ts                 (new)
      activity-matching.test.ts            (new)
      activity-sync.ts                     (new)
      activity-sync.test.ts                (new)
      users.ts                             (modify)
      users.test.ts                        (modify)
      protected-paths.ts                   (modify)
      protected-paths.test.ts              (modify)
    app/
      page.tsx                             (modify)
      api/
        strava/webhook/route.ts            (new)
        strava/webhook/route.test.ts       (new)
        cron/reconcile-activities/route.ts (new)
        cron/reconcile-activities/route.test.ts (new)
```

- `lib/strava.ts` grows from OAuth-only HTTP calls into the full Strava HTTP surface (adds activity fetch endpoints); `lib/strava-client.ts` is a new, separate layer on top that adds token-refresh-on-401 — kept apart from `strava.ts` so the raw HTTP calls stay simple and mockable, and the refresh/retry/disconnect logic (which needs DB access) has its own test cycle.
- `lib/activity-mapping.ts` (raw Strava JSON → DB row shape) and `lib/activity-matching.ts` (day/sport matching) are both pure functions with no I/O, so their edge cases (pace formatting, multi-candidate tie-breaks) get fast unit tests without touching Postgres.
- `lib/activity-sync.ts` is the thin orchestrator both entry points (webhook, cron) call — it's the only place that ties user lookup, Strava fetch, mapping, matching, and the two DB writes together.

---

### Task 1: Schema — `other` sport value, shared row types, env vars

**Files:**
- Modify: `webapp/src/db/schema.ts`
- Modify: `webapp/.env.example`
- Modify: `webapp/src/db/schema.test.ts`

**Interfaces:**
- Produces: `activitySportEnum` including `'other'`; exported types `User`, `Activity`, `NewActivity`, `PlannedWorkout`, `ActivitySport` consumed by every later task.

- [ ] **Step 1: Add `'other'` to the activity sport enum**

In `webapp/src/db/schema.ts`, change line 19:

```typescript
export const activitySportEnum = pgEnum('activity_sport', ['run', 'trail_run', 'ride', 'mtb', 'swim', 'other']);
```

- [ ] **Step 2: Export shared row/enum types**

At the end of `webapp/src/db/schema.ts`, after the `insights` table definition, add:

```typescript
export type User = typeof users.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type PlannedWorkout = typeof plannedWorkouts.$inferSelect;
export type ActivitySport = (typeof activitySportEnum.enumValues)[number];
```

- [ ] **Step 3: Add a schema test for the new enum value**

Append to `webapp/src/db/schema.test.ts`:

```typescript
describe('schema: activities table', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it('accepts sport="other" for activity types outside the five supported sports', async () => {
    const [user] = await db
      .insert(users)
      .values({
        stravaAthleteId: 777,
        name: 'Test Athlete',
        timezone: 'UTC',
        accessToken: 'enc-access',
        refreshToken: 'enc-refresh',
        expiresAt: new Date(),
      })
      .returning();

    const [inserted] = await db
      .insert(activities)
      .values({
        userId: user.id,
        stravaActivityId: 1001,
        date: new Date('2026-07-10'),
        sport: 'other',
        duration: 1800,
        rawPayload: { type: 'WeightTraining' },
      })
      .returning();

    expect(inserted.sport).toBe('other');
  });
});
```

This needs `activities` imported alongside `users` — update the top import line of `webapp/src/db/schema.test.ts`:

```typescript
import { activities, users } from '@/db/schema';
```

- [ ] **Step 4: Add the new env vars**

In `webapp/.env.example`, append:

```
STRAVA_WEBHOOK_VERIFY_TOKEN=
CRON_SECRET=
```

- [ ] **Step 5: Generate and run the migration**

```bash
cd webapp
npx drizzle-kit generate
npm run db:migrate
```

Expected: a new SQL file under `webapp/src/db/migrations/` containing `ALTER TYPE "public"."activity_sport" ADD VALUE 'other';`, and `Migrations applied.` printed.

Verify:

```bash
docker compose exec postgres psql -U quamentum -d quamentum -c "SELECT unnest(enum_range(NULL::activity_sport));"
```

Expected: `run`, `trail_run`, `ride`, `mtb`, `swim`, `other` listed.

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: all tests pass, including the new `schema: activities table` test.

- [ ] **Step 7: Commit**

```bash
cd D:\ClaudeCode\Quamentum
git add webapp/src/db webapp/.env.example
git commit -m "Add 'other' activity sport, shared row types, and sync env vars"
```

---

### Task 2: Exempt webhook/cron routes from session protection

**Files:**
- Modify: `webapp/src/lib/protected-paths.ts`
- Modify: `webapp/src/lib/protected-paths.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `isProtectedPath` returning `false` for `/api/strava/*` and `/api/cron/*`, so `proxy.ts` doesn't redirect Strava's or Vercel's requests to `/sign-in`.

- [ ] **Step 1: Write the failing tests**

Add to `webapp/src/lib/protected-paths.test.ts`:

```typescript
  it('does not protect the Strava webhook route', () => {
    expect(isProtectedPath('/api/strava/webhook')).toBe(false);
  });

  it('does not protect cron routes', () => {
    expect(isProtectedPath('/api/cron/reconcile-activities')).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd webapp
npm test -- protected-paths
```

Expected: FAIL — both new assertions return `true` instead of `false`.

- [ ] **Step 3: Update `PUBLIC_PREFIXES`**

In `webapp/src/lib/protected-paths.ts`:

```typescript
const PUBLIC_PREFIXES = ['/sign-in', '/api/auth', '/api/strava', '/api/cron', '/_next', '/favicon.ico'];

export function isProtectedPath(pathname: string): boolean {
  return !PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- protected-paths
```

Expected: PASS, all assertions green.

- [ ] **Step 5: Commit**

```bash
cd D:\ClaudeCode\Quamentum
git add webapp/src/lib/protected-paths.ts webapp/src/lib/protected-paths.test.ts
git commit -m "Exempt Strava webhook and cron routes from session protection"
```

---

### Task 3: User lookup/mutation helpers for sync

**Files:**
- Modify: `webapp/src/lib/users.ts`
- Modify: `webapp/src/lib/users.test.ts`

**Interfaces:**
- Consumes: `User` type (Task 1), `encrypt`/`decrypt` (`lib/crypto.ts`, existing).
- Produces: `findUserByStravaAthleteId(stravaAthleteId: number): Promise<User | null>`, `getConnectedUsers(): Promise<User[]>`, `decryptUserTokens(user: Pick<User, 'accessToken' | 'refreshToken'>): { accessToken: string; refreshToken: string }`, `updateUserTokens(userId: string, tokens: StravaTokenSet): Promise<void>`, `markUserDisconnected(userId: string): Promise<void>` — all consumed by Task 5 (`strava-client.ts`) and Task 8/10 (sync + cron).

- [ ] **Step 1: Write the failing tests**

Append to `webapp/src/lib/users.test.ts`:

```typescript
describe('findUserByStravaAthleteId', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it('finds a user by their Strava athlete id', async () => {
    const created = await upsertUserFromStrava(
      { id: 4242, firstname: 'Ada', lastname: 'Lovelace', timezone: null },
      { accessToken: 'a', refreshToken: 'r', expiresAt: new Date() },
    );

    const found = await findUserByStravaAthleteId(4242);
    expect(found?.id).toBe(created.id);
  });

  it('returns null when no user matches', async () => {
    expect(await findUserByStravaAthleteId(999999)).toBeNull();
  });
});

describe('getConnectedUsers', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it('returns only users with connection_status="connected"', async () => {
    const connected = await upsertUserFromStrava(
      { id: 1, firstname: 'Connected', lastname: 'User', timezone: null },
      { accessToken: 'a', refreshToken: 'r', expiresAt: new Date() },
    );
    const disconnected = await upsertUserFromStrava(
      { id: 2, firstname: 'Disconnected', lastname: 'User', timezone: null },
      { accessToken: 'a', refreshToken: 'r', expiresAt: new Date() },
    );
    await markUserDisconnected(disconnected.id);

    const result = await getConnectedUsers();
    expect(result.map((u) => u.id)).toEqual([connected.id]);
  });
});

describe('decryptUserTokens / updateUserTokens', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it('round-trips tokens through encrypt/decrypt', async () => {
    const user = await upsertUserFromStrava(
      { id: 3, firstname: 'Grace', lastname: 'Hopper', timezone: null },
      { accessToken: 'original-access', refreshToken: 'original-refresh', expiresAt: new Date() },
    );

    expect(decryptUserTokens(user)).toEqual({
      accessToken: 'original-access',
      refreshToken: 'original-refresh',
    });

    await updateUserTokens(user.id, {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    });

    const refreshed = await findUserByStravaAthleteId(3);
    expect(decryptUserTokens(refreshed!)).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
  });
});

describe('markUserDisconnected', () => {
  beforeEach(async () => {
    await truncateAllTables();
  });

  it('sets connection_status to disconnected', async () => {
    const user = await upsertUserFromStrava(
      { id: 5, firstname: 'Test', lastname: 'User', timezone: null },
      { accessToken: 'a', refreshToken: 'r', expiresAt: new Date() },
    );

    await markUserDisconnected(user.id);

    const found = await findUserByStravaAthleteId(5);
    expect(found?.connectionStatus).toBe('disconnected');
  });
});
```

Update the top of `webapp/src/lib/users.test.ts` to import the new functions:

```typescript
import {
  upsertUserFromStrava,
  findUserByStravaAthleteId,
  getConnectedUsers,
  decryptUserTokens,
  updateUserTokens,
  markUserDisconnected,
} from './users';
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd webapp
npm test -- users.test
```

Expected: FAIL with "is not a function" for each new import.

- [ ] **Step 3: Implement the helpers**

In `webapp/src/lib/users.ts`, update imports and add the new functions:

```typescript
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users, type User } from '@/db/schema';
import { encrypt, decrypt } from './crypto';
```

Append after `upsertUserFromStrava`:

```typescript
export async function findUserByStravaAthleteId(stravaAthleteId: number): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.stravaAthleteId, stravaAthleteId));
  return user ?? null;
}

export async function getConnectedUsers(): Promise<User[]> {
  return db.select().from(users).where(eq(users.connectionStatus, 'connected'));
}

export function decryptUserTokens(
  user: Pick<User, 'accessToken' | 'refreshToken'>,
): { accessToken: string; refreshToken: string } {
  const key = encryptionKey();
  return {
    accessToken: decrypt(user.accessToken, key),
    refreshToken: decrypt(user.refreshToken, key),
  };
}

export async function updateUserTokens(userId: string, tokens: StravaTokenSet): Promise<void> {
  const key = encryptionKey();
  await db
    .update(users)
    .set({
      accessToken: encrypt(tokens.accessToken, key),
      refreshToken: encrypt(tokens.refreshToken, key),
      expiresAt: tokens.expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function markUserDisconnected(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ connectionStatus: 'disconnected', updatedAt: new Date() })
    .where(eq(users.id, userId));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- users.test
```

Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
cd D:\ClaudeCode\Quamentum
git add webapp/src/lib/users.ts webapp/src/lib/users.test.ts
git commit -m "Add user lookup and token-mutation helpers for activity sync"
```

---

### Task 4: Strava activity HTTP calls + sport-type mapping

**Files:**
- Modify: `webapp/src/lib/strava.ts`
- Modify: `webapp/src/lib/strava.test.ts`
- Create: `webapp/src/lib/sport-mapping.ts`
- Create: `webapp/src/lib/sport-mapping.test.ts`

**Interfaces:**
- Consumes: `ActivitySport` type (Task 1).
- Produces: `StravaApiError` (has `.status: number`), `StravaActivity` interface, `StravaActivitySummary` interface, `fetchStravaActivity(accessToken, activityId): Promise<StravaActivity>`, `fetchStravaActivities(accessToken, afterEpochSeconds): Promise<StravaActivitySummary[]>` — consumed by Task 5. `mapStravaSportType(sportType: string): ActivitySport` — consumed by Task 6.

- [ ] **Step 1: Write the failing sport-mapping test**

Create `webapp/src/lib/sport-mapping.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { mapStravaSportType } from './sport-mapping';

describe('mapStravaSportType', () => {
  it.each([
    ['Run', 'run'],
    ['TrailRun', 'trail_run'],
    ['Ride', 'ride'],
    ['GravelRide', 'ride'],
    ['VirtualRide', 'ride'],
    ['MountainBikeRide', 'mtb'],
    ['EMountainBikeRide', 'mtb'],
    ['Swim', 'swim'],
  ])('maps Strava sport_type %s to %s', (input, expected) => {
    expect(mapStravaSportType(input)).toBe(expected);
  });

  it('maps unrecognized sport types to "other"', () => {
    expect(mapStravaSportType('Hike')).toBe('other');
    expect(mapStravaSportType('WeightTraining')).toBe('other');
    expect(mapStravaSportType('Yoga')).toBe('other');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd webapp
npm test -- sport-mapping
```

Expected: FAIL — `./sport-mapping` module not found.

- [ ] **Step 3: Write `webapp/src/lib/sport-mapping.ts`**

```typescript
import type { ActivitySport } from '@/db/schema';

const SPORT_TYPE_MAP: Record<string, ActivitySport> = {
  Run: 'run',
  TrailRun: 'trail_run',
  Ride: 'ride',
  GravelRide: 'ride',
  VirtualRide: 'ride',
  MountainBikeRide: 'mtb',
  EMountainBikeRide: 'mtb',
  Swim: 'swim',
};

export function mapStravaSportType(sportType: string): ActivitySport {
  return SPORT_TYPE_MAP[sportType] ?? 'other';
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- sport-mapping
```

Expected: PASS.

- [ ] **Step 5: Write the failing tests for the new Strava HTTP calls**

Append to `webapp/src/lib/strava.test.ts`:

```typescript
describe('fetchStravaActivity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches an activity by id with a bearer token', async () => {
    const mockActivity = { id: 555, sport_type: 'Run', start_date_local: '2026-07-10T06:00:00Z', moving_time: 1800, distance: 5000, average_speed: 2.78 };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => mockActivity });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchStravaActivity('token-abc', 555);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.strava.com/api/v3/activities/555',
      expect.objectContaining({ headers: { Authorization: 'Bearer token-abc' } }),
    );
    expect(result).toEqual(mockActivity);
  });

  it('throws a StravaApiError with the response status on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(fetchStravaActivity('token-abc', 555)).rejects.toMatchObject({ status: 401 });
  });
});

describe('fetchStravaActivities', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists activities after a given timestamp', async () => {
    const mockList = [{ id: 1 }, { id: 2 }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => mockList });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchStravaActivities('token-abc', 1700000000);

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.origin + calledUrl.pathname).toBe('https://www.strava.com/api/v3/athlete/activities');
    expect(calledUrl.searchParams.get('after')).toBe('1700000000');
    expect(result).toEqual(mockList);
  });

  it('throws a StravaApiError on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchStravaActivities('token-abc', 1700000000)).rejects.toMatchObject({ status: 500 });
  });
});
```

Update the import line at the top of `webapp/src/lib/strava.test.ts`:

```typescript
import { getStravaAuthorizeUrl, exchangeCodeForToken, refreshStravaToken, fetchStravaActivity, fetchStravaActivities } from './strava';
```

- [ ] **Step 6: Run tests to verify they fail**

```bash
npm test -- strava.test
```

Expected: FAIL — `fetchStravaActivity`/`fetchStravaActivities` are not exported.

- [ ] **Step 7: Add the activity HTTP calls to `webapp/src/lib/strava.ts`**

Append to `webapp/src/lib/strava.ts`:

```typescript
const STRAVA_API_BASE = 'https://www.strava.com/api/v3';

export class StravaApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'StravaApiError';
  }
}

export interface StravaActivity {
  id: number;
  sport_type: string;
  start_date_local: string;
  moving_time: number;
  distance: number;
  average_heartrate?: number;
  average_speed: number;
  average_watts?: number;
  suffer_score?: number | null;
}

export async function fetchStravaActivity(accessToken: string, activityId: number): Promise<StravaActivity> {
  const response = await fetch(`${STRAVA_API_BASE}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new StravaApiError(response.status, `Strava activity endpoint responded with ${response.status}`);
  }
  return response.json();
}

export interface StravaActivitySummary {
  id: number;
}

export async function fetchStravaActivities(
  accessToken: string,
  afterEpochSeconds: number,
): Promise<StravaActivitySummary[]> {
  const url = new URL(`${STRAVA_API_BASE}/athlete/activities`);
  url.searchParams.set('after', String(afterEpochSeconds));
  url.searchParams.set('per_page', '100');

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new StravaApiError(response.status, `Strava activities endpoint responded with ${response.status}`);
  }
  return response.json();
}
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
npm test -- strava.test
```

Expected: PASS, all tests green.

- [ ] **Step 9: Commit**

```bash
cd D:\ClaudeCode\Quamentum
git add webapp/src/lib/strava.ts webapp/src/lib/strava.test.ts webapp/src/lib/sport-mapping.ts webapp/src/lib/sport-mapping.test.ts
git commit -m "Add Strava activity HTTP calls and sport-type mapping"
```

---

### Task 5: Authenticated Strava client (401 refresh-and-retry)

**Files:**
- Create: `webapp/src/lib/strava-client.ts`
- Create: `webapp/src/lib/strava-client.test.ts`

**Interfaces:**
- Consumes: `decryptUserTokens`, `updateUserTokens`, `markUserDisconnected` (Task 3); `StravaApiError`, `fetchStravaActivity`, `fetchStravaActivities`, `refreshStravaToken` (Task 4, existing); `User` type (Task 1).
- Produces: `getActivity(user: User, stravaActivityId: number): Promise<StravaActivity>`, `listRecentActivityIds(user: User, after: Date): Promise<number[]>` — consumed by Task 8 (`activity-sync.ts`) and Task 10 (cron route).

- [ ] **Step 1: Write the failing tests**

Create `webapp/src/lib/strava-client.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava, findUserByStravaAthleteId } from './users';
import { getActivity, listRecentActivityIds } from './strava-client';

describe('strava-client', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function createUser() {
    return upsertUserFromStrava(
      { id: 111, firstname: 'Test', lastname: 'Athlete', timezone: null },
      { accessToken: 'good-access', refreshToken: 'good-refresh', expiresAt: new Date() },
    );
  }

  it('getActivity returns the activity on a successful first call', async () => {
    const user = await createUser();
    const mockActivity = { id: 1, sport_type: 'Run', start_date_local: '2026-07-10T06:00:00Z', moving_time: 100, distance: 100, average_speed: 1 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => mockActivity }));

    const result = await getActivity(user, 1);
    expect(result).toEqual(mockActivity);
  });

  it('getActivity refreshes the token and retries once on a 401', async () => {
    const user = await createUser();
    const mockActivity = { id: 1, sport_type: 'Run', start_date_local: '2026-07-10T06:00:00Z', moving_time: 100, distance: 100, average_speed: 1 };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token_type: 'Bearer',
          expires_at: 1900000000,
          expires_in: 21600,
          access_token: 'refreshed-access',
          refresh_token: 'refreshed-refresh',
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => mockActivity });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getActivity(user, 1);

    expect(result).toEqual(mockActivity);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Third call (the retry) must use the refreshed token.
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer refreshed-access');

    const refreshed = await findUserByStravaAthleteId(111);
    expect(refreshed?.connectionStatus).toBe('connected');
  });

  it('getActivity marks the user disconnected when the refresh itself fails', async () => {
    const user = await createUser();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: false, status: 400 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getActivity(user, 1)).rejects.toThrow();

    const disconnected = await findUserByStravaAthleteId(111);
    expect(disconnected?.connectionStatus).toBe('disconnected');
  });

  it('listRecentActivityIds returns just the ids', async () => {
    const user = await createUser();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 10 }, { id: 20 }] }));

    const result = await listRecentActivityIds(user, new Date('2026-07-08'));
    expect(result).toEqual([10, 20]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd webapp
npm test -- strava-client
```

Expected: FAIL — `./strava-client` module not found.

- [ ] **Step 3: Write `webapp/src/lib/strava-client.ts`**

```typescript
import type { User } from '@/db/schema';
import { decryptUserTokens, markUserDisconnected, updateUserTokens } from './users';
import {
  StravaApiError,
  fetchStravaActivities,
  fetchStravaActivity,
  refreshStravaToken,
  type StravaActivity,
} from './strava';

async function withTokenRefresh<T>(user: User, call: (accessToken: string) => Promise<T>): Promise<T> {
  const { accessToken, refreshToken } = decryptUserTokens(user);

  try {
    return await call(accessToken);
  } catch (error) {
    if (!(error instanceof StravaApiError) || error.status !== 401) {
      throw error;
    }

    let refreshed;
    try {
      refreshed = await refreshStravaToken(refreshToken);
    } catch (refreshError) {
      await markUserDisconnected(user.id);
      throw refreshError;
    }

    await updateUserTokens(user.id, {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: new Date(refreshed.expires_at * 1000),
    });

    return call(refreshed.access_token);
  }
}

export function getActivity(user: User, stravaActivityId: number): Promise<StravaActivity> {
  return withTokenRefresh(user, (accessToken) => fetchStravaActivity(accessToken, stravaActivityId));
}

export function listRecentActivityIds(user: User, after: Date): Promise<number[]> {
  return withTokenRefresh(user, async (accessToken) => {
    const summaries = await fetchStravaActivities(accessToken, Math.floor(after.getTime() / 1000));
    return summaries.map((summary) => summary.id);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- strava-client
```

Expected: PASS, all four tests green.

- [ ] **Step 5: Commit**

```bash
cd D:\ClaudeCode\Quamentum
git add webapp/src/lib/strava-client.ts webapp/src/lib/strava-client.test.ts
git commit -m "Add authenticated Strava client with 401 refresh-and-retry"
```

---

### Task 6: Map a raw Strava activity to an `activities` row

**Files:**
- Create: `webapp/src/lib/activity-mapping.ts`
- Create: `webapp/src/lib/activity-mapping.test.ts`

**Interfaces:**
- Consumes: `mapStravaSportType` (Task 4), `StravaActivity` type (Task 4), `NewActivity` type (Task 1).
- Produces: `mapStravaActivityToRow(raw: StravaActivity, userId: string): NewActivity` — consumed by Task 8 (`activity-sync.ts`).

- [ ] **Step 1: Write the failing tests**

Create `webapp/src/lib/activity-mapping.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { StravaActivity } from './strava';
import { mapStravaActivityToRow } from './activity-mapping';

function baseActivity(overrides: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 42,
    sport_type: 'Run',
    start_date_local: '2026-07-10T06:15:00Z',
    moving_time: 1800,
    distance: 5000,
    average_speed: 2.7778, // 5000m / 1800s
    ...overrides,
  };
}

describe('mapStravaActivityToRow', () => {
  it('maps common fields and the activity date from start_date_local', () => {
    const row = mapStravaActivityToRow(baseActivity(), 'user-1');

    expect(row.userId).toBe('user-1');
    expect(row.stravaActivityId).toBe(42);
    expect(row.date).toEqual(new Date('2026-07-10'));
    expect(row.sport).toBe('run');
    expect(row.duration).toBe(1800);
    expect(row.distance).toBe('5.00');
    expect(row.rawPayload).toEqual(baseActivity());
  });

  it('rounds average heart rate when present, null when absent', () => {
    expect(mapStravaActivityToRow(baseActivity({ average_heartrate: 152.6 }), 'user-1').avgHr).toBe(153);
    expect(mapStravaActivityToRow(baseActivity(), 'user-1').avgHr).toBeNull();
  });

  it('formats pace as min:sec/km for run/trail_run/swim', () => {
    const row = mapStravaActivityToRow(baseActivity({ average_speed: 2.7778 }), 'user-1');
    expect(row.avgPaceOrPower).toBe('6:00/km');
  });

  it('formats power in watts for ride/mtb', () => {
    const row = mapStravaActivityToRow(
      baseActivity({ sport_type: 'Ride', average_watts: 187.4 }),
      'user-1',
    );
    expect(row.avgPaceOrPower).toBe('187W');
  });

  it('leaves avgPaceOrPower null for unmapped ("other") sports', () => {
    const row = mapStravaActivityToRow(baseActivity({ sport_type: 'WeightTraining' }), 'user-1');
    expect(row.sport).toBe('other');
    expect(row.avgPaceOrPower).toBeNull();
  });

  it('uses relative effort (suffer_score) when present', () => {
    expect(mapStravaActivityToRow(baseActivity({ suffer_score: 87 }), 'user-1').relativeEffort).toBe(87);
    expect(mapStravaActivityToRow(baseActivity(), 'user-1').relativeEffort).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd webapp
npm test -- activity-mapping
```

Expected: FAIL — `./activity-mapping` module not found.

- [ ] **Step 3: Write `webapp/src/lib/activity-mapping.ts`**

```typescript
import type { NewActivity } from '@/db/schema';
import { mapStravaSportType } from './sport-mapping';
import type { StravaActivity } from './strava';

function formatPaceOrPower(raw: StravaActivity, sport: NewActivity['sport']): string | null {
  if (sport === 'ride' || sport === 'mtb') {
    return raw.average_watts != null ? `${Math.round(raw.average_watts)}W` : null;
  }
  if ((sport === 'run' || sport === 'trail_run' || sport === 'swim') && raw.average_speed > 0) {
    const secondsPerKm = 1000 / raw.average_speed;
    const minutes = Math.floor(secondsPerKm / 60);
    const seconds = Math.round(secondsPerKm % 60)
      .toString()
      .padStart(2, '0');
    return `${minutes}:${seconds}/km`;
  }
  return null;
}

export function mapStravaActivityToRow(raw: StravaActivity, userId: string): NewActivity {
  const sport = mapStravaSportType(raw.sport_type);

  return {
    userId,
    stravaActivityId: raw.id,
    date: new Date(raw.start_date_local.slice(0, 10)),
    sport,
    duration: raw.moving_time,
    distance: (raw.distance / 1000).toFixed(2),
    avgHr: raw.average_heartrate != null ? Math.round(raw.average_heartrate) : null,
    avgPaceOrPower: formatPaceOrPower(raw, sport),
    relativeEffort: raw.suffer_score ?? null,
    rawPayload: raw,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- activity-mapping
```

Expected: PASS, all six tests green.

- [ ] **Step 5: Commit**

```bash
cd D:\ClaudeCode\Quamentum
git add webapp/src/lib/activity-mapping.ts webapp/src/lib/activity-mapping.test.ts
git commit -m "Add raw Strava activity to activities-row mapper"
```

---

### Task 7: Activity-to-planned-workout matching

**Files:**
- Create: `webapp/src/lib/activity-matching.ts`
- Create: `webapp/src/lib/activity-matching.test.ts`

**Interfaces:**
- Consumes: `Activity`, `PlannedWorkout` types (Task 1).
- Produces: `matchActivity(activity: Pick<Activity, 'date' | 'sport'>, candidates: PlannedWorkout[]): PlannedWorkout | null` — consumed by Task 8 (`activity-sync.ts`).

- [ ] **Step 1: Write the failing tests**

Create `webapp/src/lib/activity-matching.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { PlannedWorkout } from '@/db/schema';
import { matchActivity } from './activity-matching';

function workout(overrides: Partial<PlannedWorkout> = {}): PlannedWorkout {
  return {
    id: 'w1',
    userId: 'u1',
    date: new Date('2026-07-10'),
    sport: 'run',
    workoutType: 'easy',
    targetDurationMin: null,
    targetDistance: null,
    targetMetric: null,
    targetValue: null,
    notes: null,
    status: 'planned',
    source: 'user',
    supersededBy: null,
    trainingBlockId: null,
    raceEventId: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

describe('matchActivity', () => {
  it('matches a same-day, same-sport planned workout', () => {
    const candidate = workout();
    const match = matchActivity({ date: new Date('2026-07-10'), sport: 'run' }, [candidate]);
    expect(match?.id).toBe('w1');
  });

  it('does not match a different day', () => {
    const candidate = workout({ date: new Date('2026-07-11') });
    expect(matchActivity({ date: new Date('2026-07-10'), sport: 'run' }, [candidate])).toBeNull();
  });

  it('does not match a different sport', () => {
    const candidate = workout({ sport: 'ride' });
    expect(matchActivity({ date: new Date('2026-07-10'), sport: 'run' }, [candidate])).toBeNull();
  });

  it('does not match a workout that is already completed', () => {
    const candidate = workout({ status: 'completed' });
    expect(matchActivity({ date: new Date('2026-07-10'), sport: 'run' }, [candidate])).toBeNull();
  });

  it('picks the most recently created candidate when several share day and sport', () => {
    const older = workout({ id: 'older', createdAt: new Date('2026-07-01T00:00:00Z') });
    const newer = workout({ id: 'newer', createdAt: new Date('2026-07-05T00:00:00Z') });
    const match = matchActivity({ date: new Date('2026-07-10'), sport: 'run' }, [older, newer]);
    expect(match?.id).toBe('newer');
  });

  it('never matches an activity with sport="other"', () => {
    const candidate = workout();
    expect(matchActivity({ date: new Date('2026-07-10'), sport: 'other' }, [candidate])).toBeNull();
  });

  it('returns null when there are no candidates', () => {
    expect(matchActivity({ date: new Date('2026-07-10'), sport: 'run' }, [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd webapp
npm test -- activity-matching
```

Expected: FAIL — `./activity-matching` module not found.

- [ ] **Step 3: Write `webapp/src/lib/activity-matching.ts`**

```typescript
import type { Activity, PlannedWorkout } from '@/db/schema';

export function matchActivity(
  activity: Pick<Activity, 'date' | 'sport'>,
  candidates: PlannedWorkout[],
): PlannedWorkout | null {
  if (activity.sport === 'other') return null;

  const eligible = candidates.filter(
    (workout) =>
      workout.date.getTime() === activity.date.getTime() &&
      workout.sport === activity.sport &&
      workout.status === 'planned',
  );

  if (eligible.length === 0) return null;

  return eligible.reduce((latest, workout) => (workout.createdAt > latest.createdAt ? workout : latest));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- activity-matching
```

Expected: PASS, all seven tests green.

- [ ] **Step 5: Commit**

```bash
cd D:\ClaudeCode\Quamentum
git add webapp/src/lib/activity-matching.ts webapp/src/lib/activity-matching.test.ts
git commit -m "Add same-day/same-sport activity-to-planned-workout matching"
```

---

### Task 8: Activity sync orchestration

**Files:**
- Create: `webapp/src/lib/activity-sync.ts`
- Create: `webapp/src/lib/activity-sync.test.ts`

**Interfaces:**
- Consumes: `findUserByStravaAthleteId` (Task 3), `getActivity` (Task 5), `mapStravaActivityToRow` (Task 6), `matchActivity` (Task 7).
- Produces: `syncActivity(stravaAthleteId: number, stravaActivityId: number): Promise<void>` — consumed by Task 9 (webhook route) and Task 10 (cron route).

- [ ] **Step 1: Write the failing tests**

Create `webapp/src/lib/activity-sync.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from '@/db/client';
import { activities, plannedWorkouts } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava } from './users';
import { syncActivity } from './activity-sync';

function mockStravaActivity(overrides: Record<string, unknown> = {}) {
  return {
    id: 900,
    sport_type: 'Run',
    start_date_local: '2026-07-10T06:00:00Z',
    moving_time: 1800,
    distance: 5000,
    average_speed: 2.78,
    ...overrides,
  };
}

describe('syncActivity', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function createConnectedUser(stravaAthleteId: number) {
    return upsertUserFromStrava(
      { id: stravaAthleteId, firstname: 'Test', lastname: 'Athlete', timezone: null },
      { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date() },
    );
  }

  it('stores the activity and leaves it unmatched when no planned workout exists', async () => {
    const user = await createConnectedUser(201);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => mockStravaActivity() }));

    await syncActivity(201, 900);

    const [stored] = await db.select().from(activities).where(eq(activities.userId, user.id));
    expect(stored.stravaActivityId).toBe(900);
    expect(stored.matchedPlannedWorkoutId).toBeNull();
  });

  it('matches a same-day/same-sport planned workout and marks it completed', async () => {
    const user = await createConnectedUser(202);
    const [planned] = await db
      .insert(plannedWorkouts)
      .values({
        userId: user.id,
        date: new Date('2026-07-10'),
        sport: 'run',
        workoutType: 'easy',
        status: 'planned',
        source: 'user',
      })
      .returning();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => mockStravaActivity() }));

    await syncActivity(202, 900);

    const [stored] = await db.select().from(activities).where(eq(activities.userId, user.id));
    expect(stored.matchedPlannedWorkoutId).toBe(planned.id);

    const [updatedWorkout] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, planned.id));
    expect(updatedWorkout.status).toBe('completed');
  });

  it('is idempotent — syncing the same activity twice stores exactly one row', async () => {
    const user = await createConnectedUser(203);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => mockStravaActivity() }));

    await syncActivity(203, 900);
    await syncActivity(203, 900);

    const stored = await db.select().from(activities).where(eq(activities.userId, user.id));
    expect(stored).toHaveLength(1);
  });

  it('does nothing when the Strava athlete id has no local user', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await syncActivity(999999, 900);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd webapp
npm test -- activity-sync
```

Expected: FAIL — `./activity-sync` module not found.

- [ ] **Step 3: Write `webapp/src/lib/activity-sync.ts`**

```typescript
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { activities, plannedWorkouts } from '@/db/schema';
import { findUserByStravaAthleteId } from './users';
import { getActivity } from './strava-client';
import { mapStravaActivityToRow } from './activity-mapping';
import { matchActivity } from './activity-matching';

export async function syncActivity(stravaAthleteId: number, stravaActivityId: number): Promise<void> {
  const user = await findUserByStravaAthleteId(stravaAthleteId);
  if (!user || user.connectionStatus === 'disconnected') return;

  const raw = await getActivity(user, stravaActivityId);
  const row = mapStravaActivityToRow(raw, user.id);

  const [inserted] = await db
    .insert(activities)
    .values(row)
    .onConflictDoNothing({ target: activities.stravaActivityId })
    .returning();

  if (!inserted) return;

  const candidates = await db
    .select()
    .from(plannedWorkouts)
    .where(and(eq(plannedWorkouts.userId, user.id), eq(plannedWorkouts.date, inserted.date)));

  const match = matchActivity(inserted, candidates);
  if (!match) return;

  await db.transaction(async (tx) => {
    await tx.update(activities).set({ matchedPlannedWorkoutId: match.id }).where(eq(activities.id, inserted.id));
    await tx
      .update(plannedWorkouts)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(plannedWorkouts.id, match.id));
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- activity-sync
```

Expected: PASS, all four tests green.

- [ ] **Step 5: Commit**

```bash
cd D:\ClaudeCode\Quamentum
git add webapp/src/lib/activity-sync.ts webapp/src/lib/activity-sync.test.ts
git commit -m "Add activity sync orchestration: fetch, store, match"
```

---

### Task 9: Strava webhook route

**Files:**
- Create: `webapp/src/app/api/strava/webhook/route.ts`
- Create: `webapp/src/app/api/strava/webhook/route.test.ts`

**Interfaces:**
- Consumes: `syncActivity` (Task 8).
- Produces: `GET`/`POST` handlers Strava calls directly; no other task depends on this one.

- [ ] **Step 1: Write the failing tests**

Create `webapp/src/app/api/strava/webhook/route.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd webapp
npm test -- strava/webhook
```

Expected: FAIL — `./route` module not found.

- [ ] **Step 3: Write `webapp/src/app/api/strava/webhook/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { syncActivity } from '@/lib/activity-sync';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && challenge && token === process.env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
    return NextResponse.json({ 'hub.challenge': challenge });
  }
  return NextResponse.json({ error: 'invalid verify token' }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const payload = await request.json();

  if (payload.object_type === 'activity' && payload.aspect_type === 'create') {
    try {
      await syncActivity(payload.owner_id, payload.object_id);
    } catch (error) {
      console.error('Strava webhook activity sync failed:', error);
    }
  }

  return NextResponse.json({}, { status: 200 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- strava/webhook
```

Expected: PASS, all five tests green.

- [ ] **Step 5: Commit**

```bash
cd D:\ClaudeCode\Quamentum
git add webapp/src/app/api/strava/webhook
git commit -m "Add Strava webhook route: subscription verification and activity sync"
```

---

### Task 10: Reconciliation cron route + schedule

**Files:**
- Create: `webapp/src/app/api/cron/reconcile-activities/route.ts`
- Create: `webapp/src/app/api/cron/reconcile-activities/route.test.ts`
- Create: `webapp/vercel.json`

**Interfaces:**
- Consumes: `getConnectedUsers` (Task 3), `listRecentActivityIds` (Task 5), `syncActivity` (Task 8).
- Produces: a scheduled `GET` route; no other task depends on this one.

- [ ] **Step 1: Write the failing tests**

Create `webapp/src/app/api/cron/reconcile-activities/route.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { db } from '@/db/client';
import { activities } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava, markUserDisconnected } from '@/lib/users';
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd webapp
npm test -- cron/reconcile-activities
```

Expected: FAIL — `./route` module not found.

- [ ] **Step 3: Write `webapp/src/app/api/cron/reconcile-activities/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getConnectedUsers } from '@/lib/users';
import { listRecentActivityIds } from '@/lib/strava-client';
import { syncActivity } from '@/lib/activity-sync';

const RECONCILE_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const users = await getConnectedUsers();
  const after = new Date(Date.now() - RECONCILE_WINDOW_MS);

  const results = await Promise.allSettled(
    users.map(async (user) => {
      const activityIds = await listRecentActivityIds(user, after);
      for (const activityId of activityIds) {
        await syncActivity(user.stravaAthleteId, activityId);
      }
    }),
  );

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`Reconciliation failed for user ${users[index].id}:`, result.reason);
    }
  });

  return NextResponse.json({ synced: users.length });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- cron/reconcile-activities
```

Expected: PASS, all three tests green.

- [ ] **Step 5: Write `webapp/vercel.json`**

```json
{
  "crons": [
    {
      "path": "/api/cron/reconcile-activities",
      "schedule": "0 6 * * *"
    }
  ]
}
```

- [ ] **Step 6: Commit**

```bash
cd D:\ClaudeCode\Quamentum
git add webapp/src/app/api/cron webapp/vercel.json
git commit -m "Add daily reconciliation cron route for missed webhook activities"
```

---

### Task 11: Reconnect banner

**Files:**
- Modify: `webapp/src/app/page.tsx`

**Interfaces:**
- Consumes: `users.connectionStatus` (existing schema column).
- Produces: nothing consumed by later tasks — this is the final UI touch for this plan.

- [ ] **Step 1: Add the banner to `webapp/src/app/page.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { getCurrentUserId } from '@/lib/session';

export default async function HomePage() {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect('/sign-in');
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    redirect('/sign-in');
  }

  return (
    <main>
      {user.connectionStatus === 'disconnected' && (
        <p role="alert">
          Your Strava connection needs to be renewed — activities won&apos;t sync until you{' '}
          <a href="/api/auth/login">reconnect</a>.
        </p>
      )}
      <h1>Welcome, {user.name}</h1>
      <form action="/api/auth/logout" method="post">
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
cd webapp
npm run build
```

Expected: build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
cd D:\ClaudeCode\Quamentum
git add webapp/src/app/page.tsx
git commit -m "Show a reconnect banner when the Strava connection is disconnected"
```

---

### Task 12: Manual/exploratory — real reconciliation run

**Files:** none (verification only).

**Interfaces:**
- Consumes: the whole plan, run against the real Strava account connected during the Foundation & Auth plan's Task 11 walkthrough.

- [ ] **Step 1: Set local secrets**

In `webapp/.env.local`, set values for the two new vars (any random strings work locally since there's no real Strava subscription or Vercel cron trigger yet):

```
STRAVA_WEBHOOK_VERIFY_TOKEN=local-dev-verify-token
CRON_SECRET=local-dev-cron-secret
```

- [ ] **Step 2: Start the dev server**

```bash
cd webapp
npm run dev
```

Expected: `Ready` on `http://localhost:3000`.

- [ ] **Step 3: Confirm the connected user still has valid tokens**

```bash
docker compose exec postgres psql -U quamentum -d quamentum -c "SELECT strava_athlete_id, connection_status FROM users;"
```

Expected: the athlete from the earlier OAuth walkthrough, `connection_status = connected`. If Strava's short-lived access token has since expired, that's fine — the reconciliation call in the next step exercises the refresh path for real.

- [ ] **Step 4: Trigger the reconciliation route with the real CRON_SECRET**

In a new terminal:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/cron/reconcile-activities" -Headers @{ Authorization = "Bearer local-dev-cron-secret" }
```

Expected: `{ synced: 1 }` (or however many connected users exist), no error.

- [ ] **Step 5: Verify real activity data landed**

```bash
docker compose exec postgres psql -U quamentum -d quamentum -c "SELECT strava_activity_id, sport, date, duration, avg_pace_or_power FROM activities;"
```

Expected: a row for each of the athlete's real Strava activities from the last 2 days. If the connected account has no activities in that window, this is expected to be empty — that's a valid outcome, not a failure; note it and move on. If you want end-to-end confirmation with data, record a short activity on Strava (even a manual "Walk" entry, which will land as `sport=other`) and re-run Step 4.

- [ ] **Step 6: Confirm the webhook GET handshake works**

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/strava/webhook?hub.mode=subscribe&hub.verify_token=local-dev-verify-token&hub.challenge=test123"
```

Expected: `{ "hub.challenge": "test123" }`.

- [ ] **Step 7: Record the outcome**

No commit needed — this task is verification-only. Note in the final review summary whether real activity data synced successfully and whether the token-refresh path was exercised (i.e. whether the access token had actually expired by Step 4).
