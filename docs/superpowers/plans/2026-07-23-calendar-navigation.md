# Calendar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-rendered Month view (`/month`) alongside the existing Week view (`/`), with a Week⇄Month toggle and non-interactive race-day markers.

**Architecture:** Extend `webapp/src/lib/plan.ts`'s query layer with month-grid date math and range-based queries (`getPlannedInRange`, generalizing the existing `getWeekPlanned`; `getRaceEventsInRange`, new). Add a new server component route `webapp/src/app/month/page.tsx` that reads `?month=` the same way `app/page.tsx` reads `?week=`. Add one nav link on each view to reach the other.

**Tech Stack:** Next.js 16.2.10 App Router (server components, `params`/`searchParams` are `Promise`s), Drizzle ORM + Postgres, Vitest with a real Postgres test DB, zero client-side JS.

## Global Constraints

- **Zero client-side JS.** Every navigation is a plain `<a href>`; there is no client-side fetching, no `next/link`, no interactivity beyond native HTML. Race markers are plain non-interactive text/elements — never links, never `onClick`.
- **Next.js 16 App Router.** `params` and `searchParams` are `Promise`s and must be `await`ed (see `webapp/AGENTS.md`).
- **No CSS framework.** Styling is plain inline `style={{...}}` attributes only (e.g. dimmed adjacent-month cells).
- **UTC date handling.** All date math goes through the existing `startOfUTCDay`/`mondayOf`-style UTC-safe helpers in `lib/plan.ts` — never local-timezone `Date` methods.
- **Real Postgres in tests**, via the existing `truncateAllTables()` / `beforeEach` pattern (`fileParallelism: false`, port 5433). No mocking the DB.
- **`TOKEN_ENCRYPTION_KEY`** must be set (`process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex')`) in any test `beforeEach` that creates a user, matching every existing test block in `lib/plan.test.ts`.
- Run `npm run lint` and `npm test` (from `webapp/`) after every task; run `npm run build` after the final task.

---

## File Structure

- `webapp/src/lib/plan.ts` — gains `firstOfMonth`, `monthGridRange`, `getPlannedInRange`, `getRaceEventsInRange`; `getWeekPlanned` is refactored to call `getPlannedInRange` internally (behavior-identical).
- `webapp/src/lib/plan.test.ts` — gains unit tests for the two new pure date functions and integration tests for the two new range queries.
- `webapp/src/db/schema.ts` — gains one new exported type, `RaceEvent`.
- `webapp/src/app/month/page.tsx` — **new**. Server component rendering the month grid.
- `webapp/src/app/page.tsx` — gains one new nav link to `/month`.

---

### Task 1: Month-grid date math (`firstOfMonth`, `monthGridRange`)

**Files:**
- Modify: `webapp/src/lib/plan.ts` (add after `mondayOf`, around line 29)
- Test: `webapp/src/lib/plan.test.ts` (add after the `mondayOf` describe block, around line 20)

**Interfaces:**
- Produces: `firstOfMonth(date: Date): Date` — floors any date to the 1st of its UTC month.
- Produces: `monthGridRange(monthStart: Date): { gridStart: Date; gridEnd: Date }` — `gridStart` is the Monday of the week containing `monthStart`; `gridEnd` is **exclusive** (the Monday immediately after the Sunday that closes the last visible week), matching the `[start, end)` convention `getWeekPlanned`/`getPlannedInRange` already use. Takes a value that is already the 1st of a month (call `firstOfMonth` first if unsure).

- [ ] **Step 1: Write the failing tests**

Add this import and these two `describe` blocks to `webapp/src/lib/plan.test.ts`. Update the existing top import line to include the two new names:

```ts
import { firstOfMonth, formatDateParam, isEditableDate, mondayOf, monthGridRange, parseDateParam, parseWorkoutForm, readWorkoutFormValues, targetFieldsValid, type WorkoutFormValues } from './plan';
```

Insert after the closing `});` of the existing `describe('mondayOf', ...)` block:

```ts
describe('firstOfMonth', () => {
  it('floors a mid-month date to the 1st', () => {
    expect(formatDateParam(firstOfMonth(new Date('2026-07-15T00:00:00Z')))).toBe('2026-07-01');
  });

  it('returns the same date when already the 1st', () => {
    expect(formatDateParam(firstOfMonth(new Date('2026-07-01T00:00:00Z')))).toBe('2026-07-01');
  });
});

describe('monthGridRange', () => {
  it('spans a month that starts on Monday with no leading days (5 rows)', () => {
    const { gridStart, gridEnd } = monthGridRange(firstOfMonth(new Date('2026-06-15T00:00:00Z')));
    expect(formatDateParam(gridStart)).toBe('2026-06-01');
    expect(formatDateParam(gridEnd)).toBe('2026-07-06');
    expect((gridEnd.getTime() - gridStart.getTime()) / (7 * 86400000)).toBe(5);
  });

  it('spans a month that starts on Sunday with max leading days (6 rows)', () => {
    const { gridStart, gridEnd } = monthGridRange(firstOfMonth(new Date('2026-11-15T00:00:00Z')));
    expect(formatDateParam(gridStart)).toBe('2026-10-26');
    expect(formatDateParam(gridEnd)).toBe('2026-12-07');
    expect((gridEnd.getTime() - gridStart.getTime()) / (7 * 86400000)).toBe(6);
  });

  it('handles a leap-year February', () => {
    const { gridStart, gridEnd } = monthGridRange(firstOfMonth(new Date('2028-02-15T00:00:00Z')));
    expect(formatDateParam(gridStart)).toBe('2028-01-31');
    expect(formatDateParam(gridEnd)).toBe('2028-03-06');
  });

  it('spans a December-to-January year boundary', () => {
    const { gridStart, gridEnd } = monthGridRange(firstOfMonth(new Date('2026-12-15T00:00:00Z')));
    expect(formatDateParam(gridStart)).toBe('2026-11-30');
    expect(formatDateParam(gridEnd)).toBe('2027-01-04');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `webapp/`): `npm test -- plan.test.ts`
Expected: FAIL — `firstOfMonth is not a function` / `monthGridRange is not a function`.

- [ ] **Step 3: Implement**

In `webapp/src/lib/plan.ts`, add immediately after the `mondayOf` function (after line 29):

```ts
export function firstOfMonth(date: Date): Date {
  const start = startOfUTCDay(date);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
}

export function monthGridRange(monthStart: Date): { gridStart: Date; gridEnd: Date } {
  const lastOfMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
  const gridStart = mondayOf(monthStart);
  // Exclusive end, matching getWeekPlanned's [start, end) convention: the
  // Monday after the Sunday that closes out the last visible week.
  const gridEnd = mondayOf(lastOfMonth);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + 7);
  return { gridStart, gridEnd };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- plan.test.ts`
Expected: PASS, all `firstOfMonth`/`monthGridRange` tests green.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/lib/plan.ts src/lib/plan.test.ts
git commit -m "Add firstOfMonth and monthGridRange date helpers"
```

---

### Task 2: `getPlannedInRange` (generalizes `getWeekPlanned`)

**Files:**
- Modify: `webapp/src/lib/plan.ts` (replace `getWeekPlanned`, currently lines 109–123)
- Test: `webapp/src/lib/plan.test.ts` (add a new describe block; extend an existing import)

**Interfaces:**
- Consumes: nothing new (same `plannedWorkouts` table, `and`/`eq`/`gte`/`lt` from `drizzle-orm`, already imported).
- Produces: `getPlannedInRange(userId: string, start: Date, end: Date): Promise<PlannedWorkout[]>` — `[start, end)`, ordered by `createdAt`. `getWeekPlanned(userId, weekStart)` keeps its existing signature and behavior, now implemented by calling this.

- [ ] **Step 1: Write the failing test**

In `webapp/src/lib/plan.test.ts`, change the import at line 171 from:

```ts
import { getDayPlanned, getWeekPlanned } from './plan';
```

to:

```ts
import { getDayPlanned, getPlannedInRange, getWeekPlanned } from './plan';
```

Add this new `describe` block after the closing `});` of the existing `describe('getWeekPlanned / getDayPlanned', ...)` block:

```ts
describe('getPlannedInRange', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  it('returns workouts across a range spanning two months', async () => {
    const user = await createTestUser(701);
    await insertWorkout(user.id, new Date('2026-06-29'));
    await insertWorkout(user.id, new Date('2026-07-02'));
    await insertWorkout(user.id, new Date('2026-08-01')); // outside the range

    const rows = await getPlannedInRange(user.id, new Date('2026-06-25'), new Date('2026-07-06'));
    expect(rows.map((w) => w.date.toISOString().slice(0, 10)).sort()).toEqual(['2026-06-29', '2026-07-02']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- plan.test.ts`
Expected: FAIL — `getPlannedInRange is not a function`.

- [ ] **Step 3: Implement**

In `webapp/src/lib/plan.ts`, replace the existing `getWeekPlanned` function (lines 109–123) with:

```ts
export async function getPlannedInRange(userId: string, start: Date, end: Date): Promise<PlannedWorkout[]> {
  return db
    .select()
    .from(plannedWorkouts)
    .where(
      and(
        eq(plannedWorkouts.userId, userId),
        gte(plannedWorkouts.date, start),
        lt(plannedWorkouts.date, end),
      ),
    )
    .orderBy(plannedWorkouts.createdAt);
}

export async function getWeekPlanned(userId: string, weekStart: Date): Promise<PlannedWorkout[]> {
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  return getPlannedInRange(userId, weekStart, weekEnd);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- plan.test.ts`
Expected: PASS — the new `getPlannedInRange` test passes, and all existing `getWeekPlanned`/`getDayPlanned` tests still pass unchanged (confirms the refactor is behavior-identical).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/lib/plan.ts src/lib/plan.test.ts
git commit -m "Add getPlannedInRange, refactor getWeekPlanned to use it"
```

---

### Task 3: `getRaceEventsInRange`

**Files:**
- Modify: `webapp/src/db/schema.ts` (add `RaceEvent` type export, after line 153)
- Modify: `webapp/src/lib/plan.ts` (add import + new function)
- Test: `webapp/src/lib/plan.test.ts` (add a new describe block + helper)

**Interfaces:**
- Consumes: `raceEvents` table from `@/db/schema` (already defined: `id`, `userId`, `name`, `date`, `priority`, `goalTime`, `courseNotes`, `status`, `createdAt`, `updatedAt`).
- Produces: `RaceEvent` type (exported from `db/schema.ts`). `getRaceEventsInRange(userId: string, start: Date, end: Date): Promise<RaceEvent[]>` — `[start, end)`, ordered by `date`, no status filtering (cancelled races still returned, per spec).

- [ ] **Step 1: Write the failing test**

In `webapp/src/db/schema.ts`, this step's assertion is a TypeScript compile check, not a runtime test — skip to Step 3 for the type export, then write the query test below.

In `webapp/src/lib/plan.test.ts`, add near the top-level imports (after the `import { plannedWorkouts } from '@/db/schema';` line, currently line 168):

```ts
import { raceEvents } from '@/db/schema';
```

Add this helper near `insertWorkout` (after its closing brace, currently line 186):

```ts
async function insertRace(userId: string, date: Date, name = 'Test Race') {
  const [row] = await db
    .insert(raceEvents)
    .values({ userId, name, date, priority: 'A' })
    .returning();
  return row;
}
```

Add this import and describe block after the `describe('getPlannedInRange', ...)` block added in Task 2:

```ts
import { getRaceEventsInRange } from './plan';

describe('getRaceEventsInRange', () => {
  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await truncateAllTables();
  });

  it('returns races within the range and excludes ones outside it', async () => {
    const user = await createTestUser(702);
    await insertRace(user.id, new Date('2026-07-10'), 'In range');
    await insertRace(user.id, new Date('2026-08-01'), 'Out of range');

    const races = await getRaceEventsInRange(user.id, new Date('2026-07-01'), new Date('2026-07-31'));
    expect(races.map((r) => r.name)).toEqual(['In range']);
  });

  it('scopes results to the requesting user', async () => {
    const user = await createTestUser(703);
    const other = await createTestUser(704);
    await insertRace(user.id, new Date('2026-07-10'));
    await insertRace(other.id, new Date('2026-07-10'));

    const races = await getRaceEventsInRange(user.id, new Date('2026-07-01'), new Date('2026-07-31'));
    expect(races).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- plan.test.ts`
Expected: FAIL — `getRaceEventsInRange is not a function`.

- [ ] **Step 3: Implement**

In `webapp/src/db/schema.ts`, add after the existing type exports (after line 153):

```ts
export type RaceEvent = typeof raceEvents.$inferSelect;
```

In `webapp/src/lib/plan.ts`, change the schema import (line 3) from:

```ts
import { targetMetricEnum, workoutSportEnum, workoutTypeEnum, type PlannedWorkout, plannedWorkouts } from '@/db/schema';
```

to:

```ts
import { targetMetricEnum, workoutSportEnum, workoutTypeEnum, type PlannedWorkout, plannedWorkouts, type RaceEvent, raceEvents } from '@/db/schema';
```

Add this function after `getPlannedInRange`/`getWeekPlanned` (i.e. after the code added in Task 2):

```ts
export async function getRaceEventsInRange(userId: string, start: Date, end: Date): Promise<RaceEvent[]> {
  return db
    .select()
    .from(raceEvents)
    .where(and(eq(raceEvents.userId, userId), gte(raceEvents.date, start), lt(raceEvents.date, end)))
    .orderBy(raceEvents.date);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- plan.test.ts`
Expected: PASS, all tests green including the two new `getRaceEventsInRange` tests.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/db/schema.ts src/lib/plan.ts src/lib/plan.test.ts
git commit -m "Add RaceEvent type and getRaceEventsInRange query"
```

---

### Task 4: Month view page (`/month`)

**Files:**
- Create: `webapp/src/app/month/page.tsx`

**Interfaces:**
- Consumes: `getCurrentUserId()` from `@/lib/session`; `firstOfMonth`, `formatDateParam`, `getPlannedInRange`, `getRaceEventsInRange`, `mondayOf`, `monthGridRange`, `parseDateParam` from `@/lib/plan`; `type PlannedWorkout`, `type RaceEvent` from `@/db/schema`.
- Produces: the `/month` route. No exports consumed by other tasks.

No automated test for this task — matches this codebase's existing convention where page components (`app/page.tsx`, `app/plan/[date]/page.tsx`) have no test files; App Router server components here are verified via `npm run build` + `npm run lint` + a manual walkthrough, not unit tests.

- [ ] **Step 1: Create the page**

Create `webapp/src/app/month/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import type { PlannedWorkout, RaceEvent } from '@/db/schema';
import { getCurrentUserId } from '@/lib/session';
import {
  firstOfMonth,
  formatDateParam,
  getPlannedInRange,
  getRaceEventsInRange,
  mondayOf,
  monthGridRange,
  parseDateParam,
} from '@/lib/plan';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function summarizeStatus(dayWorkouts: PlannedWorkout[]): string[] {
  const labels: string[] = [];
  for (const workout of dayWorkouts) {
    if (workout.status === 'completed') labels.push('completed');
    else if (workout.status === 'planned' || workout.status === 'accepted') labels.push('planned');
    else if (workout.status === 'pending_review') labels.push('suggested');
    // rejected/superseded rows are not rendered — the workout that replaced them is.
  }
  return labels;
}

export default async function MonthPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect('/sign-in');
  }

  const sp = await searchParams;
  const monthParam = typeof sp.month === 'string' ? sp.month : undefined;
  const requested = monthParam ? parseDateParam(monthParam) : null;
  const monthStart = firstOfMonth(requested ?? new Date());
  const { gridStart, gridEnd } = monthGridRange(monthStart);

  const [workouts, races] = await Promise.all([
    getPlannedInRange(userId, gridStart, gridEnd),
    getRaceEventsInRange(userId, gridStart, gridEnd),
  ]);

  const workoutsByDate = new Map<string, PlannedWorkout[]>();
  for (const workout of workouts) {
    const key = formatDateParam(workout.date);
    const bucket = workoutsByDate.get(key);
    if (bucket) bucket.push(workout);
    else workoutsByDate.set(key, [workout]);
  }

  const racesByDate = new Map<string, RaceEvent[]>();
  for (const race of races) {
    const key = formatDateParam(race.date);
    const bucket = racesByDate.get(key);
    if (bucket) bucket.push(race);
    else racesByDate.set(key, [race]);
  }

  const totalDays = Math.round((gridEnd.getTime() - gridStart.getTime()) / (24 * 60 * 60 * 1000));
  const days = Array.from({ length: totalDays }, (_, index) => {
    const day = new Date(gridStart);
    day.setUTCDate(day.getUTCDate() + index);
    return day;
  });
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const previousMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 1, 1));
  const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const currentMonthStart = firstOfMonth(new Date());
  const weekViewHref = `/?week=${formatDateParam(mondayOf(monthStart))}`;

  return (
    <main>
      <nav>
        <a href={`/month?month=${formatDateParam(previousMonth)}`}>‹ Previous</a>{' '}
        <a href={`/month?month=${formatDateParam(currentMonthStart)}`}>Today</a>{' '}
        <a href={`/month?month=${formatDateParam(nextMonth)}`}>Next ›</a>{' '}
        <a href={weekViewHref}>Week view</a>
      </nav>
      <h1>
        {monthStart.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} {monthStart.getUTCFullYear()}
      </h1>
      <table>
        <thead>
          <tr>
            {DAY_LABELS.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={formatDateParam(week[0])}>
              {week.map((day) => {
                const key = formatDateParam(day);
                const inMonth =
                  day.getUTCMonth() === monthStart.getUTCMonth() &&
                  day.getUTCFullYear() === monthStart.getUTCFullYear();

                if (!inMonth) {
                  return (
                    <td key={key} style={{ color: '#999' }}>
                      {key}
                    </td>
                  );
                }

                const dayWorkouts = workoutsByDate.get(key) ?? [];
                const dayRaces = racesByDate.get(key) ?? [];
                const statusLabels = summarizeStatus(dayWorkouts);

                return (
                  <td key={key}>
                    <a href={`/?week=${formatDateParam(mondayOf(day))}`}>{key}</a>
                    {statusLabels.length > 0 && (
                      <ul>
                        {statusLabels.map((label, index) => (
                          <li key={index}>{label}</li>
                        ))}
                      </ul>
                    )}
                    {dayRaces.map((race) => (
                      <div key={race.id}>{race.name}</div>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
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
- Navigate several months forward and back via `‹`/`›`/"Today".
- From `/`, click "Month view" on a specific week; confirm it lands on the month containing that week. From `/month`, click "Week view"; confirm it returns to the week containing that month's 1st (not necessarily the originating week — see the spec's Data Flow section).
- Click an in-month day cell; confirm it opens `/` on the correct week.
- Confirm a race day shows its marker (add a test row directly in the DB if none exist yet) and that clicking it does nothing.
- Confirm adjacent-month filler days are dimmed (`#999`) and unclickable (no `<a>`).
- Confirm a day with two same-day races shows two stacked labels, not one.

- [ ] **Step 4: Commit**

```bash
git add src/app/month/page.tsx
git commit -m "Add Month view page"
```

---

### Task 5: Week view — link to Month view

**Files:**
- Modify: `webapp/src/app/page.tsx` (import line 6, and the `<nav>` block, lines 60–64)

**Interfaces:**
- Consumes: `firstOfMonth` from `@/lib/plan` (new import; everything else already imported).

No automated test — same rationale as Task 4 (no existing test file for this page).

- [ ] **Step 1: Add the link**

In `webapp/src/app/page.tsx`, change line 6 from:

```tsx
import { formatDateParam, getWeekPlanned, isEditableDate, mondayOf, parseDateParam } from '@/lib/plan';
```

to:

```tsx
import { firstOfMonth, formatDateParam, getWeekPlanned, isEditableDate, mondayOf, parseDateParam } from '@/lib/plan';
```

Add this line after `const currentWeekStart = mondayOf(new Date());` (line 49):

```tsx
  const monthViewHref = `/month?month=${formatDateParam(firstOfMonth(weekStart))}`;
```

Change the `<nav>` block (lines 60–64) from:

```tsx
      <nav>
        <a href={`/?week=${formatDateParam(previousWeek)}`}>‹ Previous</a>{' '}
        <a href={`/?week=${formatDateParam(currentWeekStart)}`}>Today</a>{' '}
        <a href={`/?week=${formatDateParam(nextWeek)}`}>Next ›</a>
      </nav>
```

to:

```tsx
      <nav>
        <a href={`/?week=${formatDateParam(previousWeek)}`}>‹ Previous</a>{' '}
        <a href={`/?week=${formatDateParam(currentWeekStart)}`}>Today</a>{' '}
        <a href={`/?week=${formatDateParam(nextWeek)}`}>Next ›</a>{' '}
        <a href={monthViewHref}>Month view</a>
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

Run `npm run dev`; from a specific week on `/`, click "Month view" and confirm it lands on the correct month (cross-check against the Task 4 walkthrough, which verified the reverse direction).

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "Add Month view link to Week view nav"
```
