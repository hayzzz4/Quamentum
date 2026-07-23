# Daily Check-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/checkin` page where the athlete records sleep hours, soreness, energy, and an optional note once a day, editable in place.

**Architecture:** A new `lib/checkin.ts` query/validation module (mirroring `lib/plan.ts`'s shape), a new `POST /api/checkin` route that upserts today's row via Drizzle's `onConflictDoUpdate` on the existing `checkins_user_date_unique` index, a new `app/checkin/page.tsx` server component (always today, pre-filled from the existing row if present), and one new nav link from Week view.

**Tech Stack:** Next.js 16.2.10 App Router (server components, `params`/`searchParams` are `Promise`s), Drizzle ORM + Postgres, Vitest with a real Postgres test DB, zero client-side JS.

## Global Constraints

- **Zero client-side JS.** Every navigation is a plain `<a href>`; every mutation a plain `<form method="post">`. No `next/link`, no client components, no event handlers.
- **Next.js 16 App Router.** `params` and `searchParams` are `Promise`s and must be `await`ed.
- **No CSS framework.** Plain inline `style={{...}}` only, and only where actually needed (this feature needs none).
- **UTC date handling.** "Today" is always UTC-midnight, matching the existing `startOfUTCDay`/`mondayOf` convention in `lib/plan.ts` — never local-timezone `Date` methods.
- **Real Postgres in tests**, via the existing `truncateAllTables()` / `beforeEach` pattern (`fileParallelism: false`, port 5433). No mocking the DB.
- **`TOKEN_ENCRYPTION_KEY`** must be set (`process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex')`) in any test `beforeEach` that creates a user, matching every existing test block in this codebase.
- **`@next/next/no-html-link-for-pages` eslint rule**: in this codebase's App Router setup, this rule only fires for a literal `<a href="/">` (the root path) — nested literal paths like `href="/checkin"` do not trigger it (confirmed via `npm run lint`; a disable comment added there produces an "unused directive" warning instead). Only add `{/* eslint-disable-next-line @next/next/no-html-link-for-pages -- plain anchor, no client JS by convention */}` above a literal root `href="/"`. Template-literal hrefs (e.g. `` href={`/?week=${x}`} ``) never trigger this rule regardless of target.
- Run `npm run lint` and `npm test` (from `webapp/`) after every task; run `npm run build` after the final task.

---

## File Structure

- `webapp/src/lib/checkin.ts` — **new**. Form types/parsing (`CheckinFormValues`, `CheckinInput`, `readCheckinFormValues`, `parseCheckinForm`) plus the query layer (`todayUTC`, `upsertCheckin`, `getTodayCheckin`).
- `webapp/src/lib/checkin.test.ts` — **new**. Unit tests for form parsing, integration tests for the query layer.
- `webapp/src/db/schema.ts` — gains one new exported type, `Checkin`.
- `webapp/src/app/api/checkin/route.ts` — **new**. `POST` handler: validate, upsert, redirect.
- `webapp/src/app/api/checkin/route.test.ts` — **new**. Integration tests for the route.
- `webapp/src/app/checkin/page.tsx` — **new**. The check-in form page.
- `webapp/src/app/page.tsx` — gains one new nav link to `/checkin`.

---

### Task 1: Check-in form types and validation (`lib/checkin.ts`, pure functions)

**Files:**
- Create: `webapp/src/lib/checkin.ts`
- Create: `webapp/src/lib/checkin.test.ts`

**Interfaces:**
- Produces: `CheckinFormValues` (`{ sleepHours: string; soreness: string; energy: string; note: string }`), `CheckinInput` (`{ sleepHours: string; soreness: number; energy: number; note: string | null }`), `readCheckinFormValues(formData: FormData): CheckinFormValues`, `parseCheckinForm(values: CheckinFormValues): CheckinInput | null`.

- [ ] **Step 1: Write the failing tests**

Create `webapp/src/lib/checkin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseCheckinForm, readCheckinFormValues, type CheckinFormValues } from './checkin';

describe('parseCheckinForm', () => {
  function values(overrides: Partial<CheckinFormValues> = {}): CheckinFormValues {
    return {
      sleepHours: '7.5',
      soreness: '3',
      energy: '3',
      note: '',
      ...overrides,
    };
  }

  it('parses a fully valid submission', () => {
    expect(parseCheckinForm(values())).toEqual({
      sleepHours: '7.50',
      soreness: 3,
      energy: 3,
      note: null,
    });
  });

  it('rejects a missing sleepHours', () => {
    expect(parseCheckinForm(values({ sleepHours: '' }))).toBeNull();
  });

  it('rejects a negative sleepHours', () => {
    expect(parseCheckinForm(values({ sleepHours: '-1' }))).toBeNull();
  });

  it('rejects sleepHours above 24', () => {
    expect(parseCheckinForm(values({ sleepHours: '25' }))).toBeNull();
  });

  it('rejects a missing soreness', () => {
    expect(parseCheckinForm(values({ soreness: '' }))).toBeNull();
  });

  it('rejects soreness below the 1-5 range', () => {
    expect(parseCheckinForm(values({ soreness: '0' }))).toBeNull();
  });

  it('rejects soreness above the 1-5 range', () => {
    expect(parseCheckinForm(values({ soreness: '6' }))).toBeNull();
  });

  it('accepts soreness at the boundary values 1 and 5', () => {
    expect(parseCheckinForm(values({ soreness: '1' }))?.soreness).toBe(1);
    expect(parseCheckinForm(values({ soreness: '5' }))?.soreness).toBe(5);
  });

  it('rejects a missing energy', () => {
    expect(parseCheckinForm(values({ energy: '' }))).toBeNull();
  });

  it('rejects energy below the 1-5 range', () => {
    expect(parseCheckinForm(values({ energy: '0' }))).toBeNull();
  });

  it('rejects energy above the 1-5 range', () => {
    expect(parseCheckinForm(values({ energy: '6' }))).toBeNull();
  });

  it('accepts energy at the boundary values 1 and 5', () => {
    expect(parseCheckinForm(values({ energy: '1' }))?.energy).toBe(1);
    expect(parseCheckinForm(values({ energy: '5' }))?.energy).toBe(5);
  });

  it('trims a whitespace-only note to null', () => {
    expect(parseCheckinForm(values({ note: '   ' }))?.note).toBeNull();
  });

  it('keeps a non-empty note', () => {
    expect(parseCheckinForm(values({ note: 'Felt great' }))?.note).toBe('Felt great');
  });
});

describe('readCheckinFormValues', () => {
  it('reads every field as a string, defaulting missing fields to empty', () => {
    const formData = new FormData();
    formData.set('sleepHours', '7.5');
    formData.set('soreness', '3');

    expect(readCheckinFormValues(formData)).toEqual({
      sleepHours: '7.5',
      soreness: '3',
      energy: '',
      note: '',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `webapp/`): `npm test -- checkin.test.ts`
Expected: FAIL — `Cannot find module './checkin'` (the file doesn't exist yet).

- [ ] **Step 3: Implement**

Create `webapp/src/lib/checkin.ts`:

```ts
export interface CheckinFormValues {
  sleepHours: string;
  soreness: string;
  energy: string;
  note: string;
}

export interface CheckinInput {
  sleepHours: string;
  soreness: number;
  energy: number;
  note: string | null;
}

export function readCheckinFormValues(formData: FormData): CheckinFormValues {
  return {
    sleepHours: String(formData.get('sleepHours') ?? ''),
    soreness: String(formData.get('soreness') ?? ''),
    energy: String(formData.get('energy') ?? ''),
    note: String(formData.get('note') ?? ''),
  };
}

export function parseCheckinForm(values: CheckinFormValues): CheckinInput | null {
  const sleepHours = Number(values.sleepHours);
  if (!values.sleepHours.trim() || !Number.isFinite(sleepHours) || sleepHours < 0 || sleepHours > 24) return null;

  const soreness = Number(values.soreness);
  if (!Number.isInteger(soreness) || soreness < 1 || soreness > 5) return null;

  const energy = Number(values.energy);
  if (!Number.isInteger(energy) || energy < 1 || energy > 5) return null;

  return {
    sleepHours: sleepHours.toFixed(2),
    soreness,
    energy,
    note: values.note.trim() || null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- checkin.test.ts`
Expected: PASS, all 15 tests green.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/lib/checkin.ts src/lib/checkin.test.ts
git commit -m "Add check-in form parsing and validation"
```

---

### Task 2: Check-in query layer (`todayUTC`, `upsertCheckin`, `getTodayCheckin`)

**Files:**
- Modify: `webapp/src/db/schema.ts` (add `Checkin` type export, after the existing type exports)
- Modify: `webapp/src/lib/checkin.ts` (add imports + three new functions)
- Modify: `webapp/src/lib/checkin.test.ts` (add new imports + describe blocks)

**Interfaces:**
- Consumes: `checkins` table from `@/db/schema` (already defined: `id`, `userId`, `date`, `sleepHours`, `soreness`, `energy`, `note`, `createdAt`, unique on `(userId, date)`).
- Produces: `Checkin` type (exported from `db/schema.ts`). `todayUTC(now?: Date): Date` — floors `now` (defaults to `new Date()`) to UTC midnight. `upsertCheckin(userId: string, date: Date, fields: CheckinInput): Promise<Checkin>` — inserts a new row, or updates the existing `(userId, date)` row if one exists. `getTodayCheckin(userId: string, date: Date): Promise<Checkin | null>`.

- [ ] **Step 1: Write the failing tests**

Append to `webapp/src/lib/checkin.test.ts` (after the existing content):

```ts
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from '@/db/client';
import { checkins } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava } from './users';
import { getTodayCheckin, todayUTC, upsertCheckin, type CheckinInput } from './checkin';

async function createTestUser(stravaAthleteId: number) {
  return upsertUserFromStrava(
    { id: stravaAthleteId, firstname: 'Test', lastname: 'Athlete', timezone: null },
    { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date() },
  );
}

function baseFields(overrides: Partial<CheckinInput> = {}): CheckinInput {
  return {
    sleepHours: '7.50',
    soreness: 3,
    energy: 3,
    note: null,
    ...overrides,
  };
}

describe('todayUTC', () => {
  it('floors a timestamp to UTC midnight', () => {
    const now = new Date('2026-07-23T15:42:00Z');
    expect(todayUTC(now).toISOString()).toBe('2026-07-23T00:00:00.000Z');
  });
});

describe('upsertCheckin / getTodayCheckin', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  it('creates a new row when none exists for that user and date', async () => {
    const user = await createTestUser(801);
    const date = new Date('2026-07-20');

    await upsertCheckin(user.id, date, baseFields());

    const stored = await getTodayCheckin(user.id, date);
    expect(stored?.soreness).toBe(3);
    expect(stored?.sleepHours).toBe('7.50');
  });

  it('updates the existing row instead of creating a duplicate', async () => {
    const user = await createTestUser(802);
    const date = new Date('2026-07-20');

    await upsertCheckin(user.id, date, baseFields());
    await upsertCheckin(user.id, date, baseFields({ soreness: 5, note: 'Sore today' }));

    const rows = await db.select().from(checkins).where(eq(checkins.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].soreness).toBe(5);
    expect(rows[0].note).toBe('Sore today');
  });

  it('returns null when no check-in exists for that date', async () => {
    const user = await createTestUser(803);
    expect(await getTodayCheckin(user.id, new Date('2026-07-20'))).toBeNull();
  });

  it('scopes results to the requesting user', async () => {
    const user = await createTestUser(804);
    const other = await createTestUser(805);
    const date = new Date('2026-07-20');
    await upsertCheckin(other.id, date, baseFields());

    expect(await getTodayCheckin(user.id, date)).toBeNull();
  });
});
```

The top of the file also needs `beforeEach` added to its `vitest` import (it currently only imports `describe, expect, it`):

```ts
import { beforeEach, describe, expect, it } from 'vitest';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- checkin.test.ts`
Expected: FAIL — `todayUTC`/`upsertCheckin`/`getTodayCheckin` are not exported from `./checkin`.

- [ ] **Step 3: Implement**

In `webapp/src/db/schema.ts`, add after the existing type exports (after `export type ActivitySport = ...`):

```ts
export type Checkin = typeof checkins.$inferSelect;
```

In `webapp/src/lib/checkin.ts`, add these imports at the top of the file:

```ts
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { checkins, type Checkin } from '@/db/schema';
```

Add these three functions at the end of `webapp/src/lib/checkin.ts`:

```ts
export function todayUTC(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function upsertCheckin(userId: string, date: Date, fields: CheckinInput): Promise<Checkin> {
  const [row] = await db
    .insert(checkins)
    .values({ userId, date, ...fields })
    .onConflictDoUpdate({
      target: [checkins.userId, checkins.date],
      set: { ...fields },
    })
    .returning();
  return row;
}

export async function getTodayCheckin(userId: string, date: Date): Promise<Checkin | null> {
  const [row] = await db
    .select()
    .from(checkins)
    .where(and(eq(checkins.userId, userId), eq(checkins.date, date)));
  return row ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- checkin.test.ts`
Expected: PASS, all tests green (15 from Task 1 + the new ones from this task).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/db/schema.ts src/lib/checkin.ts src/lib/checkin.test.ts
git commit -m "Add todayUTC, upsertCheckin, and getTodayCheckin"
```

---

### Task 3: `POST /api/checkin` route

**Files:**
- Create: `webapp/src/app/api/checkin/route.ts`
- Create: `webapp/src/app/api/checkin/route.test.ts`

**Interfaces:**
- Consumes: `getCurrentUserId()` from `@/lib/session`; `parseCheckinForm`, `readCheckinFormValues`, `todayUTC`, `upsertCheckin` from `@/lib/checkin`.
- Produces: the `POST /api/checkin` route. No exports consumed by other tasks (Task 4's page posts to this URL as a plain string, not an import).

- [ ] **Step 1: Write the failing tests**

Create `webapp/src/app/api/checkin/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { db } from '@/db/client';
import { checkins } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava } from '@/lib/users';
import { todayUTC } from '@/lib/checkin';
import * as sessionModule from '@/lib/session';
import { POST } from './route';

function formRequest(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return new NextRequest('http://localhost/api/checkin', { method: 'POST', body: formData });
}

async function createTestUser(stravaAthleteId: number) {
  return upsertUserFromStrava(
    { id: stravaAthleteId, firstname: 'Test', lastname: 'Athlete', timezone: null },
    { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date() },
  );
}

describe('POST /api/checkin', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects unauthenticated requests to sign-in', async () => {
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(null);
    const response = await POST(formRequest({ sleepHours: '7.5', soreness: '3', energy: '3' }));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/sign-in');
  });

  it('creates a check-in for today and redirects with saved=1', async () => {
    const user = await createTestUser(901);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);

    const response = await POST(formRequest({ sleepHours: '7.5', soreness: '3', energy: '4', note: 'Felt good' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/checkin?saved=1');
    const [stored] = await db.select().from(checkins).where(eq(checkins.userId, user.id));
    expect(stored.soreness).toBe(3);
    expect(stored.energy).toBe(4);
    expect(stored.note).toBe('Felt good');
    expect(stored.date.toISOString().slice(0, 10)).toBe(todayUTC().toISOString().slice(0, 10));
  });

  it("updates today's existing check-in instead of creating a duplicate", async () => {
    const user = await createTestUser(902);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);

    await POST(formRequest({ sleepHours: '7', soreness: '2', energy: '2' }));
    await POST(formRequest({ sleepHours: '8', soreness: '5', energy: '5' }));

    const rows = await db.select().from(checkins).where(eq(checkins.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].soreness).toBe(5);
  });

  it('redirects back to /checkin with an error when required fields are invalid', async () => {
    const user = await createTestUser(903);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);

    const response = await POST(formRequest({ sleepHours: '', soreness: '3', energy: '3' }));

    expect(response.status).toBe(303);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('/checkin');
    expect(location).toContain('error=invalid');
    const stored = await db.select().from(checkins).where(eq(checkins.userId, user.id));
    expect(stored).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- route.test.ts`
Expected: FAIL — `Cannot find module './route'` (the route file doesn't exist yet). Note this glob (`route.test.ts`) will also try to run the existing `plan/workouts` route tests; that's fine, they should still pass — only the new `api/checkin/route.test.ts` file should fail.

- [ ] **Step 3: Implement**

Create `webapp/src/app/api/checkin/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/session';
import { parseCheckinForm, readCheckinFormValues, todayUTC, upsertCheckin } from '@/lib/checkin';

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.redirect(new URL('/sign-in', request.url), 303);
  }

  const formData = await request.formData();
  const values = readCheckinFormValues(formData);
  const input = parseCheckinForm(values);
  if (!input) {
    const errorParams = new URLSearchParams({ error: 'invalid', ...values });
    return NextResponse.redirect(new URL(`/checkin?${errorParams.toString()}`, request.url), 303);
  }

  await upsertCheckin(userId, todayUTC(), input);
  return NextResponse.redirect(new URL('/checkin?saved=1', request.url), 303);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- route.test.ts`
Expected: PASS, all tests green (including the pre-existing `plan/workouts` route tests, unaffected).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/app/api/checkin/route.ts src/app/api/checkin/route.test.ts
git commit -m "Add POST /api/checkin route"
```

---

### Task 4: Check-in page (`/checkin`)

**Files:**
- Create: `webapp/src/app/checkin/page.tsx`

**Interfaces:**
- Consumes: `getCurrentUserId()` from `@/lib/session`; `getTodayCheckin`, `todayUTC` from `@/lib/checkin`.
- Produces: the `/checkin` route. No exports consumed by other tasks.

No automated test for this task — matches this codebase's existing convention where page components (`app/page.tsx`, `app/plan/[date]/page.tsx`, `app/month/page.tsx`) have no test files; verified via `npm run lint` + `npm run build` + a manual walkthrough.

- [ ] **Step 1: Create the page**

Create `webapp/src/app/checkin/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/session';
import { getTodayCheckin, todayUTC } from '@/lib/checkin';

const SCALE = [1, 2, 3, 4, 5];

export default async function CheckinPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect('/sign-in');
  }

  const sp = await searchParams;
  const field = (key: string) => (typeof sp[key] === 'string' ? (sp[key] as string) : '');
  const hasError = sp.error === 'invalid';
  const saved = sp.saved === '1';

  const today = todayUTC();
  const existing = hasError ? null : await getTodayCheckin(userId, today);

  const values = {
    sleepHours: hasError ? field('sleepHours') : (existing?.sleepHours ?? ''),
    soreness: hasError ? field('soreness') : existing?.soreness != null ? String(existing.soreness) : '',
    energy: hasError ? field('energy') : existing?.energy != null ? String(existing.energy) : '',
    note: hasError ? field('note') : (existing?.note ?? ''),
  };

  return (
    <main>
      <p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- plain anchor, no client JS by convention */}
        <a href="/">‹ Back to week</a>
      </p>
      <h1>Check in</h1>
      {saved && <p role="status">Saved.</p>}
      {hasError && <p role="alert">Please check the required fields and try again.</p>}
      <form action="/api/checkin" method="post">
        <div>
          <label htmlFor="sleepHours">Sleep (hours)</label>
          <input
            id="sleepHours"
            type="number"
            name="sleepHours"
            defaultValue={values.sleepHours}
            min="0"
            max="24"
            step="0.25"
            required
          />
        </div>
        <div>
          <span>Soreness</span>
          {SCALE.map((n) => (
            <label key={n}>
              <input type="radio" name="soreness" value={n} defaultChecked={values.soreness === String(n)} required />
              {n}
            </label>
          ))}
        </div>
        <div>
          <span>Energy</span>
          {SCALE.map((n) => (
            <label key={n}>
              <input type="radio" name="energy" value={n} defaultChecked={values.energy === String(n)} required />
              {n}
            </label>
          ))}
        </div>
        <div>
          <label htmlFor="note">Note</label>
          <textarea id="note" name="note" defaultValue={values.note} />
        </div>
        <button type="submit">Save</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Run lint and build**

```bash
npm run lint
npm run build
```

Expected: both succeed with no errors.

- [ ] **Step 3: Manual walkthrough**

Run `npm run dev`, sign in, and check each item from the spec's Manual/exploratory section:
- Submit today's check-in from a blank state; confirm it redirects to `/checkin?saved=1` and shows "Saved."
- Reload `/checkin` (drop the `?saved=1`) and confirm the just-submitted values are pre-filled (sleep hours, the correct soreness/energy radio selected, note text).
- Edit a field (e.g. change soreness) and re-submit; confirm the same row was updated, not duplicated (check the `checkins` table row count directly if needed, e.g. via `psql` or a quick script).
- Submit an invalid value (e.g. sleep hours of `30`) and confirm the form redisplays the entered values alongside the error message, rather than resetting to blank.

- [ ] **Step 4: Commit**

```bash
git add src/app/checkin/page.tsx
git commit -m "Add check-in page"
```

---

### Task 5: Week view — link to Check in

**Files:**
- Modify: `webapp/src/app/page.tsx` (the `<nav>` block)

**Interfaces:**
- Consumes: nothing new — no imports needed, the link is a static string.

No automated test — same rationale as Task 4 (no existing test file for this page).

- [ ] **Step 1: Add the link**

In `webapp/src/app/page.tsx`, change the `<nav>` block from:

```tsx
      <nav>
        <a href={`/?week=${formatDateParam(previousWeek)}`}>‹ Previous</a>{' '}
        <a href={`/?week=${formatDateParam(currentWeekStart)}`}>Today</a>{' '}
        <a href={`/?week=${formatDateParam(nextWeek)}`}>Next ›</a>{' '}
        <a href={monthViewHref}>Month view</a>
      </nav>
```

to:

```tsx
      <nav>
        <a href={`/?week=${formatDateParam(previousWeek)}`}>‹ Previous</a>{' '}
        <a href={`/?week=${formatDateParam(currentWeekStart)}`}>Today</a>{' '}
        <a href={`/?week=${formatDateParam(nextWeek)}`}>Next ›</a>{' '}
        <a href={monthViewHref}>Month view</a>{' '}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- plain anchor, no client JS by convention */}
        <a href="/checkin">Check in</a>
      </nav>
```

- [ ] **Step 2: Run lint, build, and full test suite**

```bash
npm run lint
npm run build
npm test
```

Expected: all succeed — this is the final task, so this is the full-branch verification pass.

- [ ] **Step 3: Manual walkthrough**

Run `npm run dev`; from `/`, click "Check in" and confirm it navigates to `/checkin`.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "Add Check in link to Week view nav"
```
