# Plan Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an athlete view the current week as a day grid and add, edit, or delete planned workouts for today or any future day.

**Architecture:** A new `src/lib/plan.ts` module holds all date math, form validation, and `planned_workouts` queries/mutations. Three new `POST`-only API routes (`/api/plan/workouts`, `/api/plan/workouts/[id]/update`, `/api/plan/workouts/[id]/delete`) drive plain HTML forms on four pages: the existing `app/page.tsx` (rebuilt as a Week grid), a new day list page, and new/edit builder-form pages that share one presentational component.

**Tech Stack:** Next.js 16.2.10 (App Router, Server Components only, no client JS), Drizzle ORM against Postgres, Vitest against a real test database.

**Source spec:** `docs/superpowers/specs/2026-07-19-plan-authoring-design.md` (Status: Approved for planning)

## Global Constraints

- Next.js 16.2.10 — this is **not** the Next.js you know (see `webapp/AGENTS.md`). `params` and `searchParams` on pages and route handlers are `Promise`s; always `await` them. Read `webapp/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/{page,route,dynamic-routes}.md` if anything here looks unfamiliar.
- No CSS framework, no client-side JS/state anywhere in this app. Every mutation is a plain HTML `<form method="post">`. Plain forms can only send `GET`/`POST`, so every edit/delete is its own `POST`-only route — never `PATCH`/`DELETE` HTTP methods.
- `src/proxy.ts` (this app's Next 16 middleware-equivalent) + `src/lib/protected-paths.ts` already gate every path that isn't in `PUBLIC_PREFIXES` (`/sign-in`, `/api/auth`, `/api/strava`, `/api/cron`, `/_next`, `/favicon.ico`). `/plan/*` and `/api/plan/*` are therefore already session-protected at the edge with no changes needed there. Per existing convention (`src/app/page.tsx`, `src/app/api/onboarding/email/route.ts`), every new page/route still redundantly calls `getCurrentUserId()` itself as defense-in-depth.
- No new DB migrations. `planned_workouts` (`src/db/schema.ts:87-105`) already has every column this feature needs.
- Numeric columns (`targetDistance`) are typed as `string` by Drizzle on insert/update, formatted like `src/lib/activity-mapping.ts:34` does (`.toFixed(2)`).
- Tests: `npm test` runs Vitest with `fileParallelism: false` against a real Postgres reached via `TEST_DATABASE_URL` (see `webapp/vitest.config.ts`, `src/test/global-setup.ts`). Integration tests call `truncateAllTables()` from `src/test/db-helpers.ts` in `beforeEach` — never mock the DB. Other commands: `npm run build` (typecheck + build), `npm run lint`.
- All commands below assume the working directory `D:\ClaudeCode\Quamentum\webapp`.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/plan.ts` | new | Date/validation helpers + all `planned_workouts` queries and mutations |
| `src/lib/plan.test.ts` | new | Unit tests (pure helpers) + integration tests (real Postgres) for `plan.ts` |
| `src/app/api/plan/workouts/route.ts` | new | `POST` — create a planned workout |
| `src/app/api/plan/workouts/route.test.ts` | new | Integration tests for create |
| `src/app/api/plan/workouts/[id]/update/route.ts` | new | `POST` — update a planned workout |
| `src/app/api/plan/workouts/[id]/update/route.test.ts` | new | Integration tests for update |
| `src/app/api/plan/workouts/[id]/delete/route.ts` | new | `POST` — delete a planned workout |
| `src/app/api/plan/workouts/[id]/delete/route.test.ts` | new | Integration tests for delete |
| `src/app/plan/[date]/page.tsx` | new | Day list: shows that day's workouts, Edit/Delete/Add links (today/future only) |
| `src/app/plan/PlanWorkoutForm.tsx` | new | Shared builder-form component used by the new and edit pages |
| `src/app/plan/[date]/new/page.tsx` | new | Builder form for creating a workout on a given day |
| `src/app/plan/[date]/[workoutId]/edit/page.tsx` | new | Builder form for editing an existing workout |
| `src/app/page.tsx` | modified | Becomes the Week grid (keeps the existing reconnect banner + sign-out form) |

No automated tests exist anywhere in this codebase for `page.tsx` files (Server Components using `redirect`/`notFound`) — only for `lib/*.ts` and `route.ts` handlers. This plan follows that boundary: pages get `npm run build` (typecheck) as their automated gate, plus a manual check; the full interactive walkthrough happens once in Task 12.

---

### Task 1: `lib/plan.ts` — date parsing and editability helpers

**Files:**
- Create: `src/lib/plan.ts`
- Test: `src/lib/plan.test.ts`

**Interfaces:**
- Produces: `formatDateParam(date: Date): string`, `parseDateParam(raw: string): Date | null`, `mondayOf(date: Date): Date`, `isEditableDate(date: Date, now?: Date): boolean` — used by every later task.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatDateParam, isEditableDate, mondayOf, parseDateParam } from './plan';

describe('mondayOf', () => {
  it('returns the same date when given a Monday', () => {
    expect(formatDateParam(mondayOf(new Date('2026-07-20T00:00:00Z')))).toBe('2026-07-20');
  });

  it('rolls back to Monday when given a Sunday', () => {
    expect(formatDateParam(mondayOf(new Date('2026-07-26T00:00:00Z')))).toBe('2026-07-20');
  });

  it('rolls back across a month boundary', () => {
    expect(formatDateParam(mondayOf(new Date('2026-08-02T00:00:00Z')))).toBe('2026-07-27');
  });

  it('rolls back across a year boundary', () => {
    expect(formatDateParam(mondayOf(new Date('2026-01-01T00:00:00Z')))).toBe('2025-12-29');
  });
});

describe('parseDateParam', () => {
  it('parses a valid YYYY-MM-DD string', () => {
    const date = parseDateParam('2026-07-20');
    expect(date && formatDateParam(date)).toBe('2026-07-20');
  });

  it('rejects a malformed string', () => {
    expect(parseDateParam('not-a-date')).toBeNull();
  });

  it('rejects a string with an invalid calendar date', () => {
    expect(parseDateParam('2026-02-30')).toBeNull();
  });
});

describe('isEditableDate', () => {
  const now = new Date('2026-07-20T15:00:00Z');

  it('treats today as editable', () => {
    expect(isEditableDate(new Date('2026-07-20'), now)).toBe(true);
  });

  it('treats a future date as editable', () => {
    expect(isEditableDate(new Date('2026-07-21'), now)).toBe(true);
  });

  it('treats a past date as not editable', () => {
    expect(isEditableDate(new Date('2026-07-19'), now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- plan.test.ts`
Expected: FAIL — `Cannot find module './plan'`

- [ ] **Step 3: Create `src/lib/plan.ts` with the helpers**

```ts
const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateParam(raw: string): Date | null {
  if (!DATE_PARAM_RE.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Guards against JS rolling an invalid calendar date (e.g. Feb 30) into the next month.
  return date.toISOString().slice(0, 10) === raw ? date : null;
}

export function formatDateParam(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUTCDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function mondayOf(date: Date): Date {
  const start = startOfUTCDay(date);
  const weekday = start.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

export function isEditableDate(date: Date, now: Date = new Date()): boolean {
  return date.getTime() >= startOfUTCDay(now).getTime();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- plan.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan.ts src/lib/plan.test.ts
git commit -m "Add plan.ts date parsing and editability helpers"
```

---

### Task 2: `lib/plan.ts` — builder-form parsing and validation

**Files:**
- Modify: `src/lib/plan.ts`
- Modify: `src/lib/plan.test.ts`

**Interfaces:**
- Consumes: nothing new from Task 1 beyond the file itself.
- Produces: `WorkoutFormValues` (all-string shape read straight from `FormData`), `PlannedWorkoutInput` (typed shape ready for `db.insert`/`db.update`), `readWorkoutFormValues(formData: FormData): WorkoutFormValues`, `parseWorkoutForm(values: WorkoutFormValues): PlannedWorkoutInput | null`, `targetFieldsValid(targetMetric: string | null, targetValue: string | null): boolean` — the three API routes (Tasks 5-7) and both builder pages (Tasks 9-10) depend on these.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/plan.test.ts`:

```ts
import { parseWorkoutForm, readWorkoutFormValues, targetFieldsValid, type WorkoutFormValues } from './plan';

describe('targetFieldsValid', () => {
  it('is valid when neither field is set', () => {
    expect(targetFieldsValid(null, null)).toBe(true);
  });

  it('is valid when both fields are set', () => {
    expect(targetFieldsValid('pace', '5:00/km')).toBe(true);
  });

  it('is invalid when only targetMetric is set', () => {
    expect(targetFieldsValid('pace', null)).toBe(false);
  });

  it('is invalid when only targetValue is set', () => {
    expect(targetFieldsValid(null, '5:00/km')).toBe(false);
  });
});

describe('parseWorkoutForm', () => {
  function values(overrides: Partial<WorkoutFormValues> = {}): WorkoutFormValues {
    return {
      sport: 'run',
      workoutType: 'easy',
      targetDurationMin: '',
      targetDistance: '',
      targetMetric: '',
      targetValue: '',
      notes: '',
      ...overrides,
    };
  }

  it('parses a minimal valid submission', () => {
    expect(parseWorkoutForm(values())).toEqual({
      sport: 'run',
      workoutType: 'easy',
      targetDurationMin: null,
      targetDistance: null,
      targetMetric: null,
      targetValue: null,
      notes: null,
    });
  });

  it('parses a fully populated submission', () => {
    const input = parseWorkoutForm(
      values({
        targetDurationMin: '45',
        targetDistance: '10',
        targetMetric: 'pace',
        targetValue: '5:00/km',
        notes: 'Keep it easy',
      }),
    );
    expect(input).toEqual({
      sport: 'run',
      workoutType: 'easy',
      targetDurationMin: 45,
      targetDistance: '10.00',
      targetMetric: 'pace',
      targetValue: '5:00/km',
      notes: 'Keep it easy',
    });
  });

  it('rejects an invalid sport', () => {
    expect(parseWorkoutForm(values({ sport: 'skiing' }))).toBeNull();
  });

  it('rejects a missing workout type', () => {
    expect(parseWorkoutForm(values({ workoutType: '' }))).toBeNull();
  });

  it('rejects an invalid target metric', () => {
    expect(parseWorkoutForm(values({ targetMetric: 'vibes', targetValue: 'good' }))).toBeNull();
  });

  it('rejects targetMetric set without targetValue', () => {
    expect(parseWorkoutForm(values({ targetMetric: 'pace' }))).toBeNull();
  });

  it('rejects targetValue set without targetMetric', () => {
    expect(parseWorkoutForm(values({ targetValue: '5:00/km' }))).toBeNull();
  });

  it('rejects a non-positive duration', () => {
    expect(parseWorkoutForm(values({ targetDurationMin: '0' }))).toBeNull();
  });
});

describe('readWorkoutFormValues', () => {
  it('reads every field as a string, defaulting missing fields to empty', () => {
    const formData = new FormData();
    formData.set('sport', 'run');
    formData.set('workoutType', 'easy');

    expect(readWorkoutFormValues(formData)).toEqual({
      sport: 'run',
      workoutType: 'easy',
      targetDurationMin: '',
      targetDistance: '',
      targetMetric: '',
      targetValue: '',
      notes: '',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- plan.test.ts`
Expected: FAIL — `parseWorkoutForm`/`readWorkoutFormValues`/`targetFieldsValid` are not exported

- [ ] **Step 3: Append the parsing/validation code to `src/lib/plan.ts`**

Add this import at the top of `src/lib/plan.ts`:

```ts
import { targetMetricEnum, workoutSportEnum, workoutTypeEnum, type PlannedWorkout } from '@/db/schema';
```

Append to `src/lib/plan.ts`:

```ts
const VALID_SPORTS = new Set<string>(workoutSportEnum.enumValues);
const VALID_WORKOUT_TYPES = new Set<string>(workoutTypeEnum.enumValues);
const VALID_TARGET_METRICS = new Set<string>(targetMetricEnum.enumValues);

export interface WorkoutFormValues {
  sport: string;
  workoutType: string;
  targetDurationMin: string;
  targetDistance: string;
  targetMetric: string;
  targetValue: string;
  notes: string;
}

export interface PlannedWorkoutInput {
  sport: PlannedWorkout['sport'];
  workoutType: PlannedWorkout['workoutType'];
  targetDurationMin: number | null;
  targetDistance: string | null;
  targetMetric: PlannedWorkout['targetMetric'];
  targetValue: string | null;
  notes: string | null;
}

export function targetFieldsValid(targetMetric: string | null, targetValue: string | null): boolean {
  return (targetMetric !== null) === (targetValue !== null);
}

export function readWorkoutFormValues(formData: FormData): WorkoutFormValues {
  return {
    sport: String(formData.get('sport') ?? ''),
    workoutType: String(formData.get('workoutType') ?? ''),
    targetDurationMin: String(formData.get('targetDurationMin') ?? ''),
    targetDistance: String(formData.get('targetDistance') ?? ''),
    targetMetric: String(formData.get('targetMetric') ?? ''),
    targetValue: String(formData.get('targetValue') ?? ''),
    notes: String(formData.get('notes') ?? ''),
  };
}

export function parseWorkoutForm(values: WorkoutFormValues): PlannedWorkoutInput | null {
  if (!VALID_SPORTS.has(values.sport)) return null;
  if (!VALID_WORKOUT_TYPES.has(values.workoutType)) return null;

  const targetMetric = values.targetMetric.trim() || null;
  const targetValue = values.targetValue.trim() || null;
  if (targetMetric !== null && !VALID_TARGET_METRICS.has(targetMetric)) return null;
  if (!targetFieldsValid(targetMetric, targetValue)) return null;

  let targetDurationMin: number | null = null;
  if (values.targetDurationMin.trim()) {
    const parsed = Number(values.targetDurationMin);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    targetDurationMin = parsed;
  }

  let targetDistance: string | null = null;
  if (values.targetDistance.trim()) {
    const parsed = Number(values.targetDistance);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    targetDistance = parsed.toFixed(2);
  }

  return {
    sport: values.sport as PlannedWorkout['sport'],
    workoutType: values.workoutType as PlannedWorkout['workoutType'],
    targetDurationMin,
    targetDistance,
    targetMetric: targetMetric as PlannedWorkout['targetMetric'],
    targetValue,
    notes: values.notes.trim() || null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- plan.test.ts`
Expected: PASS (all tests from Task 1 and Task 2)

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan.ts src/lib/plan.test.ts
git commit -m "Add planned-workout form parsing and validation"
```

---

### Task 3: `lib/plan.ts` — week/day read queries

**Files:**
- Modify: `src/lib/plan.ts`
- Modify: `src/lib/plan.test.ts`

**Interfaces:**
- Consumes: `PlannedWorkoutInput` (Task 2) only as a test fixture shape.
- Produces: `getWeekPlanned(userId: string, weekStart: Date): Promise<PlannedWorkout[]>`, `getDayPlanned(userId: string, date: Date): Promise<PlannedWorkout[]>` — consumed by the Week grid (Task 11) and day page (Task 8).

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/plan.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from '@/db/client';
import { plannedWorkouts } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava } from './users';
import { getDayPlanned, getWeekPlanned } from './plan';

async function createTestUser(stravaAthleteId: number) {
  return upsertUserFromStrava(
    { id: stravaAthleteId, firstname: 'Test', lastname: 'Athlete', timezone: null },
    { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date() },
  );
}

async function insertWorkout(userId: string, date: Date, sport: (typeof plannedWorkouts.$inferInsert)['sport'] = 'run') {
  const [row] = await db
    .insert(plannedWorkouts)
    .values({ userId, date, sport, workoutType: 'easy', status: 'planned', source: 'user' })
    .returning();
  return row;
}

describe('getWeekPlanned / getDayPlanned', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  it('returns only workouts within the requested 7-day window', async () => {
    const user = await createTestUser(501);
    await insertWorkout(user.id, new Date('2026-07-20'));
    await insertWorkout(user.id, new Date('2026-07-26'));
    await insertWorkout(user.id, new Date('2026-07-27')); // outside the window

    const week = await getWeekPlanned(user.id, new Date('2026-07-20'));
    expect(week.map((w) => w.date.toISOString().slice(0, 10)).sort()).toEqual(['2026-07-20', '2026-07-26']);
  });

  it('scopes results to the requesting user', async () => {
    const user = await createTestUser(502);
    const other = await createTestUser(503);
    await insertWorkout(user.id, new Date('2026-07-20'));
    await insertWorkout(other.id, new Date('2026-07-20'));

    const week = await getWeekPlanned(user.id, new Date('2026-07-20'));
    expect(week).toHaveLength(1);
  });

  it('returns every workout for a single day, including multiple same-day entries', async () => {
    const user = await createTestUser(504);
    await insertWorkout(user.id, new Date('2026-07-20'), 'swim');
    await insertWorkout(user.id, new Date('2026-07-20'), 'run');

    const day = await getDayPlanned(user.id, new Date('2026-07-20'));
    expect(day.map((w) => w.sport).sort()).toEqual(['run', 'swim']);
  });
});
```

Note: Task 1's top-of-file import was `import { describe, expect, it } from 'vitest';` (no `beforeEach`, since those were pure-function tests). This task's tests need `beforeEach`, so change that line to:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- plan.test.ts`
Expected: FAIL — `getWeekPlanned`/`getDayPlanned` are not exported

- [ ] **Step 3: Append the queries to `src/lib/plan.ts`**

Add these imports at the top of `src/lib/plan.ts` (merge with the existing `@/db/schema` import):

```ts
import { and, eq, gte, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { plannedWorkouts } from '@/db/schema';
```

Append to `src/lib/plan.ts`:

```ts
export async function getWeekPlanned(userId: string, weekStart: Date): Promise<PlannedWorkout[]> {
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  return db
    .select()
    .from(plannedWorkouts)
    .where(
      and(
        eq(plannedWorkouts.userId, userId),
        gte(plannedWorkouts.date, weekStart),
        lt(plannedWorkouts.date, weekEnd),
      ),
    );
}

export async function getDayPlanned(userId: string, date: Date): Promise<PlannedWorkout[]> {
  return db
    .select()
    .from(plannedWorkouts)
    .where(and(eq(plannedWorkouts.userId, userId), eq(plannedWorkouts.date, date)));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- plan.test.ts`
Expected: PASS (all tests so far)

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan.ts src/lib/plan.test.ts
git commit -m "Add getWeekPlanned and getDayPlanned queries"
```

---

### Task 4: `lib/plan.ts` — create/read-owned/update/delete mutations

**Files:**
- Modify: `src/lib/plan.ts`
- Modify: `src/lib/plan.test.ts`

**Interfaces:**
- Consumes: `PlannedWorkoutInput` (Task 2).
- Produces: `createPlannedWorkout(userId: string, date: Date, fields: PlannedWorkoutInput): Promise<PlannedWorkout>`, `getOwnedPlannedWorkout(userId: string, workoutId: string): Promise<PlannedWorkout | null>`, `updatePlannedWorkout(userId: string, workoutId: string, fields: PlannedWorkoutInput): Promise<PlannedWorkout | null>`, `deletePlannedWorkout(userId: string, workoutId: string): Promise<'deleted' | 'not_found' | 'not_deletable'>` — all three API routes (Tasks 5-7) depend on these.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/plan.test.ts`:

```ts
import {
  createPlannedWorkout,
  deletePlannedWorkout,
  getOwnedPlannedWorkout,
  updatePlannedWorkout,
  type PlannedWorkoutInput,
} from './plan';

function baseFields(overrides: Partial<PlannedWorkoutInput> = {}): PlannedWorkoutInput {
  return {
    sport: 'run',
    workoutType: 'easy',
    targetDurationMin: null,
    targetDistance: null,
    targetMetric: null,
    targetValue: null,
    notes: null,
    ...overrides,
  };
}

describe('createPlannedWorkout', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  it('creates a workout with source=user and status=planned', async () => {
    const user = await createTestUser(601);
    const created = await createPlannedWorkout(user.id, new Date('2026-07-20'), baseFields());
    expect(created.source).toBe('user');
    expect(created.status).toBe('planned');
    expect(created.sport).toBe('run');
  });
});

describe('getOwnedPlannedWorkout', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  it('returns the workout for its owner', async () => {
    const user = await createTestUser(602);
    const created = await createPlannedWorkout(user.id, new Date('2026-07-20'), baseFields());
    expect((await getOwnedPlannedWorkout(user.id, created.id))?.id).toBe(created.id);
  });

  it('returns null when the workout belongs to another user', async () => {
    const owner = await createTestUser(603);
    const other = await createTestUser(604);
    const created = await createPlannedWorkout(owner.id, new Date('2026-07-20'), baseFields());
    expect(await getOwnedPlannedWorkout(other.id, created.id)).toBeNull();
  });

  it('returns null for a nonexistent workout id', async () => {
    const user = await createTestUser(605);
    expect(await getOwnedPlannedWorkout(user.id, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('updatePlannedWorkout', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  it('updates the fields of a workout the user owns', async () => {
    const user = await createTestUser(606);
    const created = await createPlannedWorkout(user.id, new Date('2026-07-20'), baseFields());
    const updated = await updatePlannedWorkout(
      user.id,
      created.id,
      baseFields({ workoutType: 'tempo', notes: 'Push the middle mile' }),
    );
    expect(updated?.workoutType).toBe('tempo');
    expect(updated?.notes).toBe('Push the middle mile');
  });

  it('returns null and does not update a workout owned by another user', async () => {
    const owner = await createTestUser(607);
    const other = await createTestUser(608);
    const created = await createPlannedWorkout(owner.id, new Date('2026-07-20'), baseFields());

    const result = await updatePlannedWorkout(other.id, created.id, baseFields({ workoutType: 'tempo' }));
    expect(result).toBeNull();

    const [stillOriginal] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, created.id));
    expect(stillOriginal.workoutType).toBe('easy');
  });
});

describe('deletePlannedWorkout', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  it('deletes a planned-status workout the user owns', async () => {
    const user = await createTestUser(609);
    const created = await createPlannedWorkout(user.id, new Date('2026-07-20'), baseFields());
    expect(await deletePlannedWorkout(user.id, created.id)).toBe('deleted');
    expect(await getOwnedPlannedWorkout(user.id, created.id)).toBeNull();
  });

  it('returns not_found for another user\'s workout and leaves it untouched', async () => {
    const owner = await createTestUser(610);
    const other = await createTestUser(611);
    const created = await createPlannedWorkout(owner.id, new Date('2026-07-20'), baseFields());

    expect(await deletePlannedWorkout(other.id, created.id)).toBe('not_found');
    expect(await getOwnedPlannedWorkout(owner.id, created.id)).not.toBeNull();
  });

  it('returns not_deletable for a completed workout and leaves it untouched', async () => {
    const user = await createTestUser(612);
    const created = await createPlannedWorkout(user.id, new Date('2026-07-20'), baseFields());
    await db.update(plannedWorkouts).set({ status: 'completed' }).where(eq(plannedWorkouts.id, created.id));

    expect(await deletePlannedWorkout(user.id, created.id)).toBe('not_deletable');
    const [stillThere] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, created.id));
    expect(stillThere.status).toBe('completed');
  });
});
```

Add `PlannedWorkoutInput` to the existing `import { ... } from './plan'` type-only imports at the top of the test file if not already present.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- plan.test.ts`
Expected: FAIL — `createPlannedWorkout`/`getOwnedPlannedWorkout`/`updatePlannedWorkout`/`deletePlannedWorkout` are not exported

- [ ] **Step 3: Append the mutations to `src/lib/plan.ts`**

```ts
export async function createPlannedWorkout(
  userId: string,
  date: Date,
  fields: PlannedWorkoutInput,
): Promise<PlannedWorkout> {
  const [inserted] = await db
    .insert(plannedWorkouts)
    .values({ userId, date, source: 'user', status: 'planned', ...fields })
    .returning();
  return inserted;
}

export async function getOwnedPlannedWorkout(userId: string, workoutId: string): Promise<PlannedWorkout | null> {
  const [workout] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, workoutId));
  if (!workout || workout.userId !== userId) return null;
  return workout;
}

export async function updatePlannedWorkout(
  userId: string,
  workoutId: string,
  fields: PlannedWorkoutInput,
): Promise<PlannedWorkout | null> {
  const [updated] = await db
    .update(plannedWorkouts)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(plannedWorkouts.id, workoutId), eq(plannedWorkouts.userId, userId)))
    .returning();
  return updated ?? null;
}

export type DeletePlannedWorkoutResult = 'deleted' | 'not_found' | 'not_deletable';

export async function deletePlannedWorkout(userId: string, workoutId: string): Promise<DeletePlannedWorkoutResult> {
  const [existing] = await db
    .select()
    .from(plannedWorkouts)
    .where(and(eq(plannedWorkouts.id, workoutId), eq(plannedWorkouts.userId, userId)));
  if (!existing) return 'not_found';
  if (existing.status === 'completed') return 'not_deletable';
  await db.delete(plannedWorkouts).where(eq(plannedWorkouts.id, workoutId));
  return 'deleted';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- plan.test.ts`
Expected: PASS (full file — this is the complete `plan.ts` test suite)

- [ ] **Step 5: Commit**

```bash
git add src/lib/plan.ts src/lib/plan.test.ts
git commit -m "Add createPlannedWorkout, getOwnedPlannedWorkout, updatePlannedWorkout, deletePlannedWorkout"
```

---

### Task 5: `POST /api/plan/workouts` — create route

**Files:**
- Create: `src/app/api/plan/workouts/route.ts`
- Test: `src/app/api/plan/workouts/route.test.ts`

**Interfaces:**
- Consumes: `getCurrentUserId` (`@/lib/session`), `createPlannedWorkout`, `parseDateParam`, `isEditableDate`, `parseWorkoutForm`, `readWorkoutFormValues` (`@/lib/plan`, Tasks 1-4).
- Produces: nothing new consumed elsewhere — this route is a leaf, wired up by the "new workout" page in Task 9.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/plan/workouts/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { db } from '@/db/client';
import { plannedWorkouts } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava } from '@/lib/users';
import * as sessionModule from '@/lib/session';
import { POST } from './route';

function formRequest(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return new NextRequest('http://localhost/api/plan/workouts', { method: 'POST', body: formData });
}

async function createTestUser(stravaAthleteId: number) {
  return upsertUserFromStrava(
    { id: stravaAthleteId, firstname: 'Test', lastname: 'Athlete', timezone: null },
    { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date() },
  );
}

describe('POST /api/plan/workouts', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects unauthenticated requests to sign-in', async () => {
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(null);
    const response = await POST(formRequest({ date: '2099-06-01', sport: 'run', workoutType: 'easy' }));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/sign-in');
  });

  it('creates a workout and redirects to the day page', async () => {
    const user = await createTestUser(701);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);

    const response = await POST(formRequest({ date: '2099-06-01', sport: 'run', workoutType: 'easy' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/plan/2099-06-01');
    const [stored] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.userId, user.id));
    expect(stored.sport).toBe('run');
    expect(stored.source).toBe('user');
  });

  it('redirects back to the new-workout form with an error when required fields are invalid', async () => {
    const user = await createTestUser(702);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);

    const response = await POST(formRequest({ date: '2099-06-01', sport: '', workoutType: 'easy' }));

    expect(response.status).toBe(303);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('/plan/2099-06-01/new');
    expect(location).toContain('error=invalid');
    const stored = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.userId, user.id));
    expect(stored).toHaveLength(0);
  });

  it('rejects a malformed date with a 400', async () => {
    const user = await createTestUser(703);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);

    const response = await POST(formRequest({ date: 'not-a-date', sport: 'run', workoutType: 'easy' }));
    expect(response.status).toBe(400);
  });

  it('rejects a past date with a 400', async () => {
    const user = await createTestUser(704);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);

    const response = await POST(formRequest({ date: '2000-01-01', sport: 'run', workoutType: 'easy' }));
    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/app/api/plan/workouts/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Create `src/app/api/plan/workouts/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/session';
import {
  createPlannedWorkout,
  isEditableDate,
  parseDateParam,
  parseWorkoutForm,
  readWorkoutFormValues,
} from '@/lib/plan';

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.redirect(new URL('/sign-in', request.url), 303);
  }

  const formData = await request.formData();
  const dateParam = String(formData.get('date') ?? '');
  const date = parseDateParam(dateParam);
  if (!date || !isEditableDate(date)) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 });
  }

  const values = readWorkoutFormValues(formData);
  const input = parseWorkoutForm(values);
  if (!input) {
    const errorParams = new URLSearchParams({ error: 'invalid', ...values });
    return NextResponse.redirect(new URL(`/plan/${dateParam}/new?${errorParams.toString()}`, request.url), 303);
  }

  await createPlannedWorkout(userId, date, input);
  return NextResponse.redirect(new URL(`/plan/${dateParam}`, request.url), 303);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/app/api/plan/workouts/route.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/plan/workouts/route.ts src/app/api/plan/workouts/route.test.ts
git commit -m "Add POST /api/plan/workouts create route"
```

---

### Task 6: `POST /api/plan/workouts/[id]/update` — update route

**Files:**
- Create: `src/app/api/plan/workouts/[id]/update/route.ts`
- Test: `src/app/api/plan/workouts/[id]/update/route.test.ts`

**Interfaces:**
- Consumes: `getCurrentUserId`, `getOwnedPlannedWorkout`, `updatePlannedWorkout`, `isEditableDate`, `formatDateParam`, `parseWorkoutForm`, `readWorkoutFormValues` (Tasks 1-4).

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/plan/workouts/[id]/update/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { db } from '@/db/client';
import { plannedWorkouts } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava } from '@/lib/users';
import { createPlannedWorkout, type PlannedWorkoutInput } from '@/lib/plan';
import * as sessionModule from '@/lib/session';
import { POST } from './route';

const FUTURE_DATE = new Date('2099-06-01');
const PAST_DATE = new Date('2000-01-01');

function baseFields(overrides: Partial<PlannedWorkoutInput> = {}): PlannedWorkoutInput {
  return {
    sport: 'run',
    workoutType: 'easy',
    targetDurationMin: null,
    targetDistance: null,
    targetMetric: null,
    targetValue: null,
    notes: null,
    ...overrides,
  };
}

function formValues(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    sport: 'run',
    workoutType: 'easy',
    targetDurationMin: '',
    targetDistance: '',
    targetMetric: '',
    targetValue: '',
    notes: '',
    ...overrides,
  };
}

function formRequest(id: string, fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return new NextRequest(`http://localhost/api/plan/workouts/${id}/update`, { method: 'POST', body: formData });
}

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function createTestUser(stravaAthleteId: number) {
  return upsertUserFromStrava(
    { id: stravaAthleteId, firstname: 'Test', lastname: 'Athlete', timezone: null },
    { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date() },
  );
}

describe('POST /api/plan/workouts/[id]/update', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates an owned workout and redirects to the day page', async () => {
    const user = await createTestUser(801);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);
    const workout = await createPlannedWorkout(user.id, FUTURE_DATE, baseFields());

    const response = await POST(formRequest(workout.id, formValues({ workoutType: 'tempo' })), routeParams(workout.id));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/plan/2099-06-01');
    const [stored] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, workout.id));
    expect(stored.workoutType).toBe('tempo');
  });

  it('returns 404 for a workout owned by another user', async () => {
    const owner = await createTestUser(802);
    const other = await createTestUser(803);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(other.id);
    const workout = await createPlannedWorkout(owner.id, FUTURE_DATE, baseFields());

    const response = await POST(formRequest(workout.id, formValues()), routeParams(workout.id));
    expect(response.status).toBe(404);
  });

  it('returns 404 for a nonexistent workout id', async () => {
    const user = await createTestUser(804);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);
    const missingId = '00000000-0000-0000-0000-000000000000';

    const response = await POST(formRequest(missingId, formValues()), routeParams(missingId));
    expect(response.status).toBe(404);
  });

  it('rejects editing a past-dated workout with a 400', async () => {
    const user = await createTestUser(805);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);
    const workout = await createPlannedWorkout(user.id, PAST_DATE, baseFields());

    const response = await POST(formRequest(workout.id, formValues()), routeParams(workout.id));
    expect(response.status).toBe(400);
  });

  it('redirects back to the edit form with an error when fields are invalid', async () => {
    const user = await createTestUser(806);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);
    const workout = await createPlannedWorkout(user.id, FUTURE_DATE, baseFields());

    const response = await POST(
      formRequest(workout.id, formValues({ targetMetric: 'pace' })),
      routeParams(workout.id),
    );

    expect(response.status).toBe(303);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain(`/plan/2099-06-01/${workout.id}/edit`);
    expect(location).toContain('error=invalid');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/app/api/plan/workouts/[id]/update/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Create `src/app/api/plan/workouts/[id]/update/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/session';
import {
  formatDateParam,
  getOwnedPlannedWorkout,
  isEditableDate,
  parseWorkoutForm,
  readWorkoutFormValues,
  updatePlannedWorkout,
} from '@/lib/plan';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.redirect(new URL('/sign-in', request.url), 303);
  }

  const { id } = await params;
  const existing = await getOwnedPlannedWorkout(userId, id);
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (!isEditableDate(existing.date)) {
    return NextResponse.json({ error: 'past date' }, { status: 400 });
  }

  const dateParam = formatDateParam(existing.date);
  const formData = await request.formData();
  const values = readWorkoutFormValues(formData);
  const input = parseWorkoutForm(values);
  if (!input) {
    const errorParams = new URLSearchParams({ error: 'invalid', ...values });
    return NextResponse.redirect(
      new URL(`/plan/${dateParam}/${id}/edit?${errorParams.toString()}`, request.url),
      303,
    );
  }

  const updated = await updatePlannedWorkout(userId, id, input);
  if (!updated) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return NextResponse.redirect(new URL(`/plan/${dateParam}`, request.url), 303);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/app/api/plan/workouts/[id]/update/route.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/plan/workouts/[id]/update/route.ts" "src/app/api/plan/workouts/[id]/update/route.test.ts"
git commit -m "Add POST /api/plan/workouts/[id]/update route"
```

---

### Task 7: `POST /api/plan/workouts/[id]/delete` — delete route

**Files:**
- Create: `src/app/api/plan/workouts/[id]/delete/route.ts`
- Test: `src/app/api/plan/workouts/[id]/delete/route.test.ts`

**Interfaces:**
- Consumes: `getCurrentUserId`, `getOwnedPlannedWorkout`, `deletePlannedWorkout`, `isEditableDate`, `formatDateParam` (Tasks 1-4).

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/plan/workouts/[id]/delete/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { db } from '@/db/client';
import { plannedWorkouts } from '@/db/schema';
import { truncateAllTables } from '@/test/db-helpers';
import { upsertUserFromStrava } from '@/lib/users';
import { createPlannedWorkout, type PlannedWorkoutInput } from '@/lib/plan';
import * as sessionModule from '@/lib/session';
import { POST } from './route';

const FUTURE_DATE = new Date('2099-06-01');
const PAST_DATE = new Date('2000-01-01');

function baseFields(overrides: Partial<PlannedWorkoutInput> = {}): PlannedWorkoutInput {
  return {
    sport: 'run',
    workoutType: 'easy',
    targetDurationMin: null,
    targetDistance: null,
    targetMetric: null,
    targetValue: null,
    notes: null,
    ...overrides,
  };
}

function deleteRequest(id: string) {
  return new NextRequest(`http://localhost/api/plan/workouts/${id}/delete`, { method: 'POST' });
}

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function createTestUser(stravaAthleteId: number) {
  return upsertUserFromStrava(
    { id: stravaAthleteId, firstname: 'Test', lastname: 'Athlete', timezone: null },
    { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date() },
  );
}

describe('POST /api/plan/workouts/[id]/delete', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes a planned workout and redirects to the day page', async () => {
    const user = await createTestUser(901);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);
    const workout = await createPlannedWorkout(user.id, FUTURE_DATE, baseFields());

    const response = await POST(deleteRequest(workout.id), routeParams(workout.id));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/plan/2099-06-01');
    const stored = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, workout.id));
    expect(stored).toHaveLength(0);
  });

  it('returns 404 for a workout owned by another user, and leaves it untouched', async () => {
    const owner = await createTestUser(902);
    const other = await createTestUser(903);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(other.id);
    const workout = await createPlannedWorkout(owner.id, FUTURE_DATE, baseFields());

    const response = await POST(deleteRequest(workout.id), routeParams(workout.id));

    expect(response.status).toBe(404);
    const [stored] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, workout.id));
    expect(stored).toBeDefined();
  });

  it('rejects deleting a past-dated workout with a 400, leaving it untouched', async () => {
    const user = await createTestUser(904);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);
    const workout = await createPlannedWorkout(user.id, PAST_DATE, baseFields());

    const response = await POST(deleteRequest(workout.id), routeParams(workout.id));

    expect(response.status).toBe(400);
    const [stored] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, workout.id));
    expect(stored).toBeDefined();
  });

  it('rejects deleting a completed/matched workout with a 400, leaving it untouched', async () => {
    const user = await createTestUser(905);
    vi.spyOn(sessionModule, 'getCurrentUserId').mockResolvedValue(user.id);
    const workout = await createPlannedWorkout(user.id, FUTURE_DATE, baseFields());
    await db.update(plannedWorkouts).set({ status: 'completed' }).where(eq(plannedWorkouts.id, workout.id));

    const response = await POST(deleteRequest(workout.id), routeParams(workout.id));

    expect(response.status).toBe(400);
    const [stored] = await db.select().from(plannedWorkouts).where(eq(plannedWorkouts.id, workout.id));
    expect(stored.status).toBe('completed');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/app/api/plan/workouts/[id]/delete/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Create `src/app/api/plan/workouts/[id]/delete/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/session';
import { deletePlannedWorkout, formatDateParam, getOwnedPlannedWorkout, isEditableDate } from '@/lib/plan';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.redirect(new URL('/sign-in', request.url), 303);
  }

  const { id } = await params;
  const existing = await getOwnedPlannedWorkout(userId, id);
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (!isEditableDate(existing.date)) {
    return NextResponse.json({ error: 'past date' }, { status: 400 });
  }

  const result = await deletePlannedWorkout(userId, id);
  if (result === 'not_deletable') {
    return NextResponse.json({ error: 'workout already completed' }, { status: 400 });
  }
  if (result === 'not_found') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return NextResponse.redirect(new URL(`/plan/${formatDateParam(existing.date)}`, request.url), 303);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/app/api/plan/workouts/[id]/delete/route.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/plan/workouts/[id]/delete/route.ts" "src/app/api/plan/workouts/[id]/delete/route.test.ts"
git commit -m "Add POST /api/plan/workouts/[id]/delete route"
```

---

### Task 8: Day list page — `src/app/plan/[date]/page.tsx`

**Files:**
- Create: `src/app/plan/[date]/page.tsx`

**Interfaces:**
- Consumes: `getCurrentUserId` (`@/lib/session`), `getDayPlanned`, `parseDateParam`, `isEditableDate` (`@/lib/plan`).
- Produces: nothing consumed by later tasks in code, but this is the page every other page in the flow links back to (`/plan/${date}`).

- [ ] **Step 1: Create `src/app/plan/[date]/page.tsx`**

```tsx
import { notFound, redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/session';
import { getDayPlanned, isEditableDate, parseDateParam } from '@/lib/plan';

export default async function PlanDayPage({ params }: { params: Promise<{ date: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect('/sign-in');
  }

  const { date: dateParam } = await params;
  const date = parseDateParam(dateParam);
  if (!date) {
    notFound();
  }

  const workouts = await getDayPlanned(userId, date);
  const editable = isEditableDate(date);

  return (
    <main>
      <p>
        <a href="/">‹ Back to week</a>
      </p>
      <h1>{dateParam}</h1>
      {workouts.length === 0 && <p>No workouts planned.</p>}
      <ul>
        {workouts.map((workout) => (
          <li key={workout.id}>
            {workout.sport} · {workout.workoutType}
            {editable && (
              <>
                {' '}
                <a href={`/plan/${dateParam}/${workout.id}/edit`}>Edit</a>{' '}
                <form action={`/api/plan/workouts/${workout.id}/delete`} method="post" style={{ display: 'inline' }}>
                  <button type="submit">Delete</button>
                </form>
              </>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <p>
          <a href={`/plan/${dateParam}/new`}>Add workout</a>
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 3: Manual check**

Note: the "Edit" and "Add workout" links 404 until Tasks 9-10 land — that's expected at this point. Confirm what already works:
1. Start the dev server: `npm run dev`.
2. Sign in through the existing Strava OAuth flow (`/sign-in`) so you have a valid session cookie.
3. Visit `/plan/2099-06-01` (a date with no rows yet) — confirm it renders "No workouts planned." and an "Add workout" link (this is expected to 404 for now).
4. Confirm visiting a malformed date, e.g. `/plan/not-a-date`, renders Next's 404 page rather than crashing.

- [ ] **Step 4: Commit**

```bash
git add "src/app/plan/[date]/page.tsx"
git commit -m "Add plan day list page"
```

---

### Task 9: Shared builder form + `src/app/plan/[date]/new/page.tsx`

**Files:**
- Create: `src/app/plan/PlanWorkoutForm.tsx`
- Create: `src/app/plan/[date]/new/page.tsx`

**Interfaces:**
- Consumes: `getCurrentUserId`, `parseDateParam`, `isEditableDate` (`@/lib/plan`, `@/lib/session`).
- Produces: `PlanWorkoutForm` component, reused as-is by Task 10's edit page.

- [ ] **Step 1: Create `src/app/plan/PlanWorkoutForm.tsx`**

```tsx
export interface PlanWorkoutFormValues {
  sport: string;
  workoutType: string;
  targetDurationMin: string;
  targetDistance: string;
  targetMetric: string;
  targetValue: string;
  notes: string;
}

const SPORT_OPTIONS = ['run', 'trail_run', 'ride', 'mtb', 'swim', 'rest'] as const;
const WORKOUT_TYPE_OPTIONS = ['easy', 'tempo', 'interval', 'long', 'recovery', 'technique', 'rest'] as const;
const TARGET_METRIC_OPTIONS = ['pace', 'power', 'hr_zone'] as const;

export function PlanWorkoutForm({
  action,
  values,
  hasError,
  cancelHref,
  submitLabel,
  dateFieldValue,
}: {
  action: string;
  values: PlanWorkoutFormValues;
  hasError: boolean;
  cancelHref: string;
  submitLabel: string;
  dateFieldValue?: string;
}) {
  return (
    <form action={action} method="post">
      {hasError && <p role="alert">Please check the required fields and try again.</p>}
      {dateFieldValue && <input type="hidden" name="date" value={dateFieldValue} />}
      <div>
        <label htmlFor="sport">Sport</label>
        <select id="sport" name="sport" defaultValue={values.sport} required>
          <option value="">Select a sport</option>
          {SPORT_OPTIONS.map((sport) => (
            <option key={sport} value={sport}>
              {sport}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="workoutType">Workout type</label>
        <select id="workoutType" name="workoutType" defaultValue={values.workoutType} required>
          <option value="">Select a type</option>
          {WORKOUT_TYPE_OPTIONS.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="targetDurationMin">Duration (minutes)</label>
        <input id="targetDurationMin" type="number" name="targetDurationMin" defaultValue={values.targetDurationMin} min="1" />
      </div>
      <div>
        <label htmlFor="targetDistance">Distance (km)</label>
        <input id="targetDistance" type="number" name="targetDistance" defaultValue={values.targetDistance} min="0" step="0.01" />
      </div>
      <div>
        <label htmlFor="targetMetric">Target metric</label>
        <select id="targetMetric" name="targetMetric" defaultValue={values.targetMetric}>
          <option value="">None</option>
          {TARGET_METRIC_OPTIONS.map((metric) => (
            <option key={metric} value={metric}>
              {metric}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="targetValue">Target value</label>
        <input id="targetValue" type="text" name="targetValue" defaultValue={values.targetValue} placeholder="e.g. 5:00/km" />
      </div>
      <div>
        <label htmlFor="notes">Notes</label>
        <textarea id="notes" name="notes" defaultValue={values.notes} />
      </div>
      <button type="submit">{submitLabel}</button> <a href={cancelHref}>Cancel</a>
    </form>
  );
}
```

- [ ] **Step 2: Create `src/app/plan/[date]/new/page.tsx`**

```tsx
import { notFound, redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/session';
import { isEditableDate, parseDateParam } from '@/lib/plan';
import { PlanWorkoutForm } from '@/app/plan/PlanWorkoutForm';

export default async function NewPlannedWorkoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect('/sign-in');
  }

  const { date: dateParam } = await params;
  const date = parseDateParam(dateParam);
  if (!date || !isEditableDate(date)) {
    notFound();
  }

  const sp = await searchParams;
  const field = (key: string) => (typeof sp[key] === 'string' ? (sp[key] as string) : '');

  return (
    <main>
      <p>
        <a href={`/plan/${dateParam}`}>‹ Back to {dateParam}</a>
      </p>
      <h1>Add workout — {dateParam}</h1>
      <PlanWorkoutForm
        action="/api/plan/workouts"
        dateFieldValue={dateParam}
        hasError={sp.error === 'invalid'}
        values={{
          sport: field('sport'),
          workoutType: field('workoutType'),
          targetDurationMin: field('targetDurationMin'),
          targetDistance: field('targetDistance'),
          targetMetric: field('targetMetric'),
          targetValue: field('targetValue'),
          notes: field('notes'),
        }}
        cancelHref={`/plan/${dateParam}`}
        submitLabel="Add workout"
      />
    </main>
  );
}
```

- [ ] **Step 3: Typecheck and build**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 4: Manual check**

1. With the dev server running and signed in, visit `/plan/2099-06-01/new`.
2. Submit the form with a sport and workout type selected — confirm it redirects to `/plan/2099-06-01` and the new workout now appears (the Task 8 day page now shows real data).
3. Visit `/plan/2099-06-01/new` again, submit with no sport selected — confirm it re-renders the form with the "Please check the required fields" message and the error banner.
4. Manually navigate to a past date's new page, e.g. `/plan/2000-01-01/new` — confirm it renders Next's 404 page rather than an editable form.

- [ ] **Step 5: Commit**

```bash
git add src/app/plan/PlanWorkoutForm.tsx "src/app/plan/[date]/new/page.tsx"
git commit -m "Add PlanWorkoutForm component and new-workout page"
```

---

### Task 10: Edit page — `src/app/plan/[date]/[workoutId]/edit/page.tsx`

**Files:**
- Create: `src/app/plan/[date]/[workoutId]/edit/page.tsx`

**Interfaces:**
- Consumes: `getCurrentUserId`, `getOwnedPlannedWorkout`, `isEditableDate`, `formatDateParam` (`@/lib/plan`, `@/lib/session`), `PlanWorkoutForm` (Task 9).

- [ ] **Step 1: Create `src/app/plan/[date]/[workoutId]/edit/page.tsx`**

```tsx
import { notFound, redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/session';
import { formatDateParam, getOwnedPlannedWorkout, isEditableDate } from '@/lib/plan';
import { PlanWorkoutForm } from '@/app/plan/PlanWorkoutForm';

export default async function EditPlannedWorkoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string; workoutId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect('/sign-in');
  }

  const { workoutId } = await params;
  const workout = await getOwnedPlannedWorkout(userId, workoutId);
  if (!workout || !isEditableDate(workout.date)) {
    notFound();
  }

  const dateParam = formatDateParam(workout.date);
  const sp = await searchParams;
  const field = (key: string, fallback: string) => (typeof sp[key] === 'string' ? (sp[key] as string) : fallback);

  return (
    <main>
      <p>
        <a href={`/plan/${dateParam}`}>‹ Back to {dateParam}</a>
      </p>
      <h1>Edit workout — {dateParam}</h1>
      <PlanWorkoutForm
        action={`/api/plan/workouts/${workoutId}/update`}
        hasError={sp.error === 'invalid'}
        values={{
          sport: field('sport', workout.sport),
          workoutType: field('workoutType', workout.workoutType),
          targetDurationMin: field('targetDurationMin', workout.targetDurationMin?.toString() ?? ''),
          targetDistance: field('targetDistance', workout.targetDistance ?? ''),
          targetMetric: field('targetMetric', workout.targetMetric ?? ''),
          targetValue: field('targetValue', workout.targetValue ?? ''),
          notes: field('notes', workout.notes ?? ''),
        }}
        cancelHref={`/plan/${dateParam}`}
        submitLabel="Save changes"
      />
    </main>
  );
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 3: Manual check**

1. With the dev server running and signed in, from the day page (`/plan/2099-06-01`) created in Task 9, click "Edit" on the workout you created.
2. Confirm the form is pre-filled with the existing values.
3. Change the workout type and submit — confirm it redirects to `/plan/2099-06-01` and the day page shows the updated value.
4. Edit again, set a target metric but clear the target value, submit — confirm it re-renders with the error banner and your other inputs preserved.
5. Manually navigate to the edit URL for a workout dated in the past (create one via a temporary direct edit of the DB row's date, or skip if impractical) — confirm it 404s rather than rendering the form.

- [ ] **Step 4: Commit**

```bash
git add "src/app/plan/[date]/[workoutId]/edit/page.tsx"
git commit -m "Add edit-workout page"
```

---

### Task 11: Week grid — modify `src/app/page.tsx`

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `getWeekPlanned`, `mondayOf`, `parseDateParam`, `formatDateParam`, `isEditableDate` (`@/lib/plan`), plus the existing `getCurrentUserId`/`db`/`users` imports already in this file.

- [ ] **Step 1: Replace `src/app/page.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { getCurrentUserId } from '@/lib/session';
import { formatDateParam, getWeekPlanned, isEditableDate, mondayOf, parseDateParam } from '@/lib/plan';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect('/sign-in');
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    redirect('/sign-in');
  }

  const sp = await searchParams;
  const weekParam = typeof sp.week === 'string' ? sp.week : undefined;
  const requested = weekParam ? parseDateParam(weekParam) : null;
  const weekStart = mondayOf(requested ?? new Date());

  const workouts = await getWeekPlanned(userId, weekStart);
  const byDate = new Map<string, typeof workouts>();
  for (const workout of workouts) {
    const key = formatDateParam(workout.date);
    const bucket = byDate.get(key);
    if (bucket) bucket.push(workout);
    else byDate.set(key, [workout]);
  }

  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setUTCDate(day.getUTCDate() + index);
    return day;
  });

  const previousWeek = new Date(weekStart);
  previousWeek.setUTCDate(previousWeek.getUTCDate() - 7);
  const nextWeek = new Date(weekStart);
  nextWeek.setUTCDate(nextWeek.getUTCDate() + 7);
  const currentWeekStart = mondayOf(new Date());

  return (
    <main>
      {user.connectionStatus === 'disconnected' && (
        <p role="alert">
          Your Strava connection needs to be renewed — activities won&apos;t sync until you{' '}
          <a href="/api/auth/login">reconnect</a>.
        </p>
      )}
      <h1>Welcome, {user.name}</h1>
      <nav>
        <a href={`/?week=${formatDateParam(previousWeek)}`}>‹ Previous</a>{' '}
        <a href={`/?week=${formatDateParam(currentWeekStart)}`}>Today</a>{' '}
        <a href={`/?week=${formatDateParam(nextWeek)}`}>Next ›</a>
      </nav>
      <table>
        <thead>
          <tr>
            {DAY_LABELS.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {days.map((day) => {
              const key = formatDateParam(day);
              const dayWorkouts = byDate.get(key) ?? [];
              const editable = isEditableDate(day);
              return (
                <td key={key}>
                  <a href={`/plan/${key}`}>{key}</a>
                  {dayWorkouts.length > 0 ? (
                    <ul>
                      {dayWorkouts.map((workout) => (
                        <li key={workout.id}>
                          {workout.sport} · {workout.workoutType}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    editable && (
                      <p>
                        <a href={`/plan/${key}/new`}>Add workout</a>
                      </p>
                    )
                  )}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      <form action="/api/auth/logout" method="post">
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck, build, and run the full test suite**

Run: `npm run build`
Expected: build succeeds with no type errors.

Run: `npm test`
Expected: all tests across the whole suite still pass (this task touches a file with no dedicated test, but must not break anything else).

- [ ] **Step 3: Manual check**

1. With the dev server running and signed in, visit `/` — confirm it shows a 7-column Mon–Sun grid for the current week, with the workouts created in Tasks 9-10 appearing on the right day.
2. Click "Next ›" and "‹ Previous" — confirm the `?week=` query param changes and the grid updates to show a different week's (empty) days.
3. Click "Today" — confirm it returns to the current week.
4. Click a day cell's date link — confirm it goes to that day's `/plan/[date]` page.
5. Confirm the reconnect banner and sign-out form still work exactly as before (unchanged behavior).

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "Rebuild home page as the Week grid"
```

---

### Task 12: Full manual/exploratory walkthrough

**Files:** none (verification only).

- [ ] **Step 1: Run the full automated suite one more time**

Run: `npm test`
Expected: all tests pass.

Run: `npm run build`
Expected: build succeeds.

Run: `npm run lint`
Expected: no lint errors.

- [ ] **Step 2: End-to-end manual walkthrough**

With the dev server running (`npm run dev`) and signed in via Strava OAuth:

1. **Add → edit → delete a future day's workout**: from the Week grid, click "Add workout" on a future day, fill in the form, submit. Confirm it appears on the day page and in the grid. Click "Edit", change a field, save. Confirm the change shows on the day page. Click "Delete". Confirm it's gone from both the day page and the grid.
2. **Add two workouts to the same day**: add a swim and a run to the same future day. Confirm both appear on the day page (as a list) and both show in that day's grid cell.
3. **Week navigation**: from the grid, step forward several weeks with "Next ›", then back with "‹ Previous", then "Today". Confirm the visible week and its `?week=` param update correctly each time, and that workouts you created stay associated with the correct date as you navigate away and back.
4. **Direct URL access to a past day**: pick a date before today. Confirm `/plan/<past-date>` shows a read-only list (no "Add workout" link, and no "Edit"/"Delete" on any existing entries — if there are none, confirm at least that the grid cell for that day has no "Add workout" link). Confirm navigating directly to `/plan/<past-date>/new` or `/plan/<past-date>/<some-id>/edit` renders Next's 404 page rather than an editable form.
5. **Reconnect banner regression check**: confirm the existing disconnected-Strava banner on `/` still renders when applicable, and sign-out still works.

- [ ] **Step 3: Report results**

If every check in Step 2 passes, the Plan Authoring feature is complete and ready for the final whole-branch review per `superpowers:finishing-a-development-branch`. If any check fails, fix the underlying task's code, re-run that task's automated tests, and repeat this walkthrough from Step 2.
