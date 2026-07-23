# Calendar Navigation — Design

**Date**: 2026-07-21
**Status**: Approved for planning

## Summary

Adds a Month view alongside the existing Week grid: a browsable month calendar
showing each day's planned-workout status at a glance, with race days marked.
This is the "Calendar Navigation" flow from
`docs/superpowers/specs/2026-07-15-strava-training-insights-design.md`,
building on `docs/superpowers/specs/2026-07-19-plan-authoring-design.md`
(Week view, add/edit/delete), which explicitly deferred Month view, the
Week⇄Month toggle, and race markers to this plan.

## Non-Goals (this plan)

- **A `GET /api/plan` JSON endpoint or any client-side fetching.** The whole
  app — including the Week grid — is zero-client-JS: every navigation is a
  plain `<a>` link, every mutation a plain form POST, fully server-rendered
  per request. Month view follows the same model: a server-rendered page per
  URL, navigated via links. This also means the master spec's client-fetch
  concerns (a stale response from an old range overwriting a newer one after
  rapid `›` clicks) don't apply here — there is no concurrent client-side
  request to race against; each navigation is a fresh full-page load.
- **A clickable Races tab.** No Race Planning feature exists yet (separate
  future plan). Race days get a visible, non-interactive marker sourced from
  the existing `race_events` table — not a link, since there's nowhere to
  link to yet.
- **AI insight/suggestion generation, race planning, daily check-ins.** Later
  plans, unrelated to calendar browsing.
- **Any change to Week view's existing behavior**, beyond adding one link to
  switch to Month view. `app/page.tsx`'s grid, editability rules, and
  add/edit/delete flows are untouched.

## Architecture

Builds on `lib/plan.ts` (query layer) and the existing Week view
(`app/page.tsx`), both shipped in Plan Authoring.

- **`lib/plan.ts` additions:**
  - `firstOfMonth(date: Date): Date` — floors any date to the 1st of its
    month (UTC, matching the existing `mondayOf`/`startOfUTCDay` convention).
  - `monthGridRange(monthStart: Date): { gridStart: Date; gridEnd: Date }` —
    pure date math. `gridStart` is the Monday of the week containing
    `monthStart`; `gridEnd` is the Sunday of the week containing the last day
    of that month. Together they always span complete weeks (5 or 6 rows of
    7 days), so the grid never shows a partial week.
  - `getPlannedInRange(userId: string, start: Date, end: Date): Promise<PlannedWorkout[]>` —
    the same query `getWeekPlanned` already runs, generalized to an arbitrary
    `[start, end)` range and ordered by `createdAt` (matching the ordering
    already added to `getWeekPlanned`/`getDayPlanned`). `getWeekPlanned` is
    refactored to call this internally with `[weekStart, weekStart+7)` —
    behavior-identical, still covered by its existing tests, no duplicated
    query.
  - `getRaceEventsInRange(userId: string, start: Date, end: Date): Promise<RaceEvent[]>` —
    new query over `race_events`, scoped to the user and the date range.
    Requires exporting `RaceEvent` from `db/schema.ts`
    (`export type RaceEvent = typeof raceEvents.$inferSelect;` — only
    `PlannedWorkout`/`Activity`/`User`/`ActivitySport` are exported today).

- **`app/month/page.tsx`** — new. Server component, reads `?month=<date>`
  (any date within the target month; invalid or missing falls back to the
  current month — same silent-fallback pattern `app/page.tsx` already uses
  for `?week=`). Resolves `monthStart = firstOfMonth(parsed ?? today)`, then
  `monthGridRange(monthStart)` for the visible grid bounds. Fetches
  `getPlannedInRange` and `getRaceEventsInRange` over the grid bounds (not
  just the calendar month) so leading/trailing adjacent-month days show
  accurate data too — though those cells render dimmed and unclickable, so
  in practice only the dot presence matters, not interactivity.

- **`app/page.tsx`** (Week view, minor addition) — one new link in the
  existing `<nav>`: "Month view", pointing to `/month?month=<first day of the
  week's month>`. No other changes.

## Data Flow — View Toggle

Each view is driven entirely by its own URL param; there is no shared
client-side state. "Keeps focusedDate fixed" (per the master spec) is
implemented as a same-request date translation between the two params:

- **Week → Month**: the link on `/` computes the month containing the
  current `weekStart` (its Monday) and links to
  `/month?month=<that month's 1st>`.
- **Month → Week**: the link on `/month` computes the week containing the
  displayed month's 1st and links to `/?week=<that Monday>`.
- **Click an in-month day cell** (Month view): links straight to
  `/?week=<Monday of that day's week>` — jumps directly into Week view on
  the right week, per the master spec ("switches to Week view with
  `focusedDate` set to that day, showing its full week").
- **Adjacent-month day cells**: dimmed, no link (unclickable) — matches the
  master spec exactly; reaching that month is done via `›`/`‹`, not by
  clicking its fillers.
- **"Today" shortcut**: each view keeps its own, resetting to
  `mondayOf(new Date())` (Week) or `firstOfMonth(new Date())` (Month).

## Month Grid Rendering

Standard 7-column grid (`DAY_LABELS` reused from Week view), one row per week
in `monthGridRange`. Each cell:

- **In-month days**: date label linking to `/?week=<Monday of that day's
  week>` (see Data Flow above — Month cells jump into Week view, unlike Week
  view's own day cells which link to `/plan/<date>`), plus a compact status
  summary. The master spec collapses the full `planned_workouts.status` set
  to three display states for grid space — this plan implements that full
  mapping now even though `pending_review`/`ai_suggested` rows can't be
  produced yet (Insight generation isn't built): `completed` → completed,
  `planned`/`accepted` → planned, `pending_review` → suggested,
  `rejected`/`superseded` → whatever status the row that stands in their
  place has (i.e. just don't render the superseded/rejected row itself). In
  practice, until Insight generation ships, only `planned` and `completed`
  will ever appear.
- **Race marker**: every `race_events` row that falls on that date renders
  as its own plain, non-interactive label in the cell (no link — see
  Non-Goals). Most days have zero; a day with two overlapping races (e.g. a
  B/C race inside an A-race's timeline) shows two stacked labels rather than
  picking one.
- **Adjacent-month days**: date label only, dimmed via inline style (muted
  color, consistent with the app's existing no-CSS-framework/inline-style
  convention), no link, no workout/race data rendered even though it was
  fetched (simpler than conditionally not-fetching it, and harmless since
  it's never displayed).

## Error Handling

- **Malformed `?month=` value**: falls back to the current month — the same
  silent-fallback `parseDateParam(...) ?? new Date()` pattern `app/page.tsx`
  already uses for `?week=`. Not a new error case.
- **Empty month** (no planned workouts or races anywhere in the grid range):
  renders normally, every cell empty — not an error.
- **Race marker for a since-removed/cancelled race**: not a special case —
  `getRaceEventsInRange` is a plain read of current `race_events` rows, so a
  deleted race simply stops appearing; a `cancelled`-status race still
  renders (no filtering by status), matching the master spec's framing of
  the marker as informational.

## Testing

- **Unit**: `firstOfMonth` and `monthGridRange` — a month starting on
  Monday (no leading days), a month starting on Sunday (max leading days), a
  month needing 6 grid rows vs. one needing 5, leap-year February, and a
  month/year boundary (December → January).
- **Integration** (real Postgres, existing global-setup/truncation
  pattern): `getPlannedInRange` returns workouts across a range spanning two
  months; `getWeekPlanned`'s existing tests still pass unchanged after the
  refactor to call it; `getRaceEventsInRange` returns races within range and
  excludes ones outside it, for the current user only.
- **Manual/exploratory**: navigate several months forward and back via
  `‹`/`›`/"Today"; toggle Week⇄Month from a specific week and confirm the
  landed-on month is correct, then toggle back and confirm it returns to
  the week containing that month's 1st (per Data Flow above, this is not
  necessarily the originating week); click an in-month day and confirm it
  opens the right week; confirm a race day shows its marker and clicking
  it does nothing; confirm adjacent-month filler days are dimmed and
  unclickable.
