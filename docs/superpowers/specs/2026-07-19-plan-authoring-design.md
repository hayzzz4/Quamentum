# Plan Authoring — Design

**Date**: 2026-07-19
**Status**: Approved for planning

## Summary

Lets an athlete author their own training plan: view the current week as a
day-by-day grid, and add, edit, or delete planned workouts for today or any
future day. This is the "Plan authoring" flow from
`docs/superpowers/specs/2026-07-15-strava-training-insights-design.md`,
scoped to the Week view only.

## Non-Goals (this plan)

- **Month view, Week⇄Month toggle, race markers** — the spec's "Calendar
  Navigation" section covers these separately; this plan builds only the
  Week-view grid and the week-to-week `‹`/`›` stepping it needs to be useful
  on its own (an athlete must be able to plan future weeks, not only the
  current one).
- **A `GET /api/plan` JSON endpoint** — nothing in this plan needs
  client-side fetching. Reads go through a plain server-side query function
  (`lib/plan.ts`) that a later Calendar Navigation plan can reuse or promote
  to an HTTP route if it turns out to need one.
- **AI insight/suggestion generation, race planning** — later plans. This
  plan only ever writes `planned_workouts` rows with `source='user'`.
- **Read-only history views beyond "past day, no edit links"** — a full
  historical detail view is this plan's day page with its edit/delete links
  omitted; nothing more elaborate.

## Architecture

Builds on the existing auth/session foundation (`lib/session.ts`) and the
already-migrated `planned_workouts` table (`db/schema.ts`).

- **`lib/plan.ts`** — new. The shared query/mutation layer:
  - `getWeekPlanned(userId, weekStart: Date)` — all `planned_workouts` rows
    for the 7 days starting `weekStart`, for the grid.
  - `getDayPlanned(userId, date: Date)` — all rows for a single date, for the
    day page.
  - `createPlannedWorkout(userId, date, fields)` — inserts with
    `source='user'`, `status='planned'`.
  - `updatePlannedWorkout(userId, workoutId, fields)` — updates a row the
    user owns.
  - `deletePlannedWorkout(userId, workoutId)` — deletes a row the user owns,
    after the status check below.
  - `mondayOf(date: Date)` — pure date-math helper: floors any date to the
    Monday of its week.
- **`app/page.tsx`** (modified) — becomes the Week grid. Reconnect banner
  stays at the top, unchanged. Below it, a 7-column Mon–Sun grid for the
  week resolved from `?week=<monday-date>` (defaulting to the current week
  via `mondayOf(today)`). Each day cell lists its planned workouts
  compactly (`{sport} · {workoutType}`) and links to `/plan/[date]`; an
  empty day instead shows a single "Add workout" link straight to
  `/plan/[date]/new`. `‹`/`›`/"Today" are plain links that recompute
  `?week=`.
- **`app/plan/[date]/page.tsx`** — new. Lists that day's planned workouts.
  For a date strictly before today: read-only (no add/edit/delete links
  rendered). For today/future: adds an "Add workout" link and, per entry,
  "Edit" and "Delete" links/forms.
- **`app/plan/[date]/new/page.tsx`** — new. The builder form (sport,
  workout type, duration/distance, target metric + value, notes), posting
  to `POST /api/plan/workouts`.
- **`app/plan/[date]/[workoutId]/edit/page.tsx`** — new. Same form,
  pre-filled, posting to `POST /api/plan/workouts/[id]/update`. Plain HTML
  forms only ever `GET`/`POST` without client JS, so — consistent with the
  rest of the app — every mutation is its own `POST`-only route rather than
  relying on `PATCH`/`DELETE` HTTP methods a `<form>` can't actually send.
- **`app/api/plan/workouts/route.ts`** — new. `POST` creates a row via
  `createPlannedWorkout`, after validating required fields and the
  today-or-future rule on the target date.
- **`app/api/plan/workouts/[id]/update/route.ts`** — new. `POST`, re-loading
  the target row, checking `user_id` against the session (404 if it belongs
  to someone else or doesn't exist), and re-checking the today-or-future
  rule on the row's `date`.
- **`app/api/plan/workouts/[id]/delete/route.ts`** — new. `POST`, same
  ownership/today-or-future checks as update, plus rejecting rows whose
  `status` isn't `planned` or `skipped` (see Error Handling).

An athlete can have multiple planned workouts on the same day (e.g. a
double-day: morning swim + evening run) — the day page shows a list, not a
single edit-in-place form.

## Data Model Changes

None. `planned_workouts` (including its `status`, `source`, and target-*
columns) already covers this feature; this plan is purely new application
code over the existing schema.

## Error Handling

- **Editing/deleting a past-dated workout**: blocked in the UI (past day
  pages render no add/edit/delete links at all) and re-checked server-side
  in every mutation route (400 if the target row's `date` is before today)
  — the API never trusts the client.
- **Deleting a workout already matched to a synced activity**
  (`status='completed'`, some `activities` row's `matched_planned_workout_id`
  points at it): rejected with 400 and a clear message. The
  `activities → planned_workouts` foreign key has no cascade, so an
  unconditional delete would otherwise surface as a raw DB constraint
  error. Editing such a row is still allowed — it only changes plan
  metadata, not the activity link.
- **Missing required fields** (`sport`, `workoutType`): 400; the builder
  page re-renders with the submitted values and a validation message.
- **`targetMetric` set without `targetValue`, or vice versa**: 400, same
  re-render-with-message pattern — the two fields are optional together but
  required together.
- **Non-owner access** (a `workoutId` that exists but belongs to another
  user): 404, not 403, so the response doesn't confirm the ID exists for
  someone else.
- **Malformed date in the URL** (`/plan/not-a-date`): a 400/not-found page
  rather than a raw crash.

## Testing

- **Unit**: `mondayOf` date math (including across month/year boundaries,
  and for a date that's already a Monday); the "one of `targetMetric` /
  `targetValue` implies the other" validation; the past-vs-today/future
  editability boundary (today itself must stay editable, not read-only).
- **Integration** (real Postgres, following the existing
  global-setup/migration/truncation pattern): create → row appears in both
  `getWeekPlanned` and `getDayPlanned`; edit changes the row's fields;
  delete removes a `planned`-status row; delete is rejected (400, row
  untouched) for a `completed`/matched row; edit/delete rejected (400) for
  a past-dated row; a request for another user's `workoutId` returns 404;
  two workouts on the same day both appear on the day page and in the
  week's grid data.
- **Manual/exploratory**: add → edit → delete a future day's workout;
  add two workouts to the same day; navigate several weeks forward and
  back via `‹`/`›`/"Today" and confirm the grid updates each time; try
  navigating directly to a past day's `/new` or `/edit` URL (should not
  render an editable form).
