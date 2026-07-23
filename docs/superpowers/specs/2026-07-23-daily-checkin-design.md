# Daily Check-in — Design

**Date**: 2026-07-23
**Status**: Approved for planning

## Summary

Adds the "Daily check-in" flow from
`docs/superpowers/specs/2026-07-15-strava-training-insights-design.md`: a
simple daily prompt (sleep hours, soreness, energy, optional note) the
athlete fills once a day, independent of activity sync or the training
plan. The `checkins` table already exists (from the foundation migration)
with a `(user_id, date)` unique index but has no application code using it
yet — this plan builds that code.

## Non-Goals (this plan)

- **Backdating / date navigation.** The check-in page always operates on
  the current date — no `?date=` param, no `/checkin/[date]` route. There's
  no consumer of historical check-ins yet (Insight generation isn't built),
  so there's nothing that needs a past-day check-in beyond what "fills once
  a day" already implies.
- **A "checked in today" status indicator on Week view.** The new nav link
  is a plain, unconditional "Check in" link — Week view doesn't query
  `checkins` to decide what to render, keeping its page untouched beyond
  the one link (same footprint as the Month view link added in Calendar
  Navigation).
- **Any read/display of check-in data elsewhere in the app.** Nothing
  currently consumes `checkins` rows besides the check-in page itself
  (Insight generation, which will read sleep/soreness/energy/note as
  context, is a separate future plan).
- **Locking a check-in after submission.** Submitting again for today edits
  the same row in place — there's no "already submitted, read-only" state.

## Architecture

Follows the same structure as Plan Authoring's `lib/plan.ts` /
`app/plan/[date]/page.tsx` split.

- **`lib/checkin.ts`** (new) — query + validation layer:
  - `CheckinFormValues` (raw strings from the form) and
    `readCheckinFormValues(formData)`, mirroring `WorkoutFormValues` /
    `readWorkoutFormValues` in `lib/plan.ts`.
  - `parseCheckinForm(values): CheckinInput | null` — validates all fields;
    returns `null` on any failure (all-or-nothing, same as
    `parseWorkoutForm`).
  - `upsertCheckin(userId, date, fields: CheckinInput): Promise<Checkin>` —
    inserts a new row, or updates the existing one for that
    `(userId, date)` pair via Drizzle's `.onConflictDoUpdate()` targeting
    the existing `checkins_user_date_unique` index — the same upsert
    pattern already used by `upsertUserFromStrava` in `lib/users.ts`.
  - `getTodayCheckin(userId, date): Promise<Checkin | null>` — reads the
    row for a `(userId, date)` pair, or `null` if none exists yet.
  - Requires exporting `Checkin` from `db/schema.ts`
    (`export type Checkin = typeof checkins.$inferSelect;` — the table
    already exists, no migration needed).

- **`app/checkin/page.tsx`** (new) — server component, no params beyond
  `searchParams`. Resolves `today = new Date()` (UTC, via the existing
  `startOfUTCDay`-style convention), calls `getTodayCheckin(userId, today)`
  to pre-fill the form. Renders a single always-editable form (no
  new/edit page split — there's only ever one row per day).

- **`app/api/checkin/route.ts`** (new) — `POST` handler: reads the form,
  validates via `parseCheckinForm`, and on success calls `upsertCheckin`
  then redirects to `/checkin?saved=1`; on failure redirects to
  `/checkin?error=invalid&<echoed fields>` (303, same pattern as
  `app/api/plan/workouts/route.ts`).

- **`app/page.tsx`** (Week view, minor addition) — one new link in the
  existing `<nav>`: "Check in", pointing to `/checkin`. No other changes.

## Fields & Validation

All in `parseCheckinForm`:

- **`sleepHours`** — required. Parsed as a number, must be `>= 0` and
  `<= 24`. Stored as a string via `.toFixed(2)`, matching the
  `targetDistance` convention in `lib/plan.ts` (both columns are
  `numeric(_, 2)`, and Drizzle's `numeric` mode returns/accepts strings).
- **`soreness`**, **`energy`** — required. Parsed as an integer, must be
  in `1..5` inclusive (matches the master spec's 1–5 scale). Submitted via
  five radio buttons per field (values `"1"`–`"5"`), not a dropdown.
- **`note`** — optional. Trimmed; empty string becomes `null` (matches the
  `notes` field convention in `parseWorkoutForm`).

Any single field failing validation invalidates the whole submission —
consistent with `parseWorkoutForm`'s all-or-nothing behavior.

## Data Flow

- **`GET /checkin`**: fetch today's row via `getTodayCheckin`. If it
  exists, its values pre-fill the form (this is what makes a second
  submission read as "editing today's check-in," not just "submit again").
  If the request has `?error=invalid&<echoed fields>` (redirected from a
  failed POST), those echoed values take precedence over the stored row,
  so the athlete doesn't lose their attempted edit. If `?saved=1` is
  present, the page shows a plain success message.
- **`POST /api/checkin`**: parse and validate the form. On failure,
  redirect to `/checkin?error=invalid&<echoed fields>`. On success, call
  `upsertCheckin(userId, today, input)`, then redirect to
  `/checkin?saved=1`.

There is no separate "create" vs. "edit" URL or button — the same form and
the same POST target handle both, since the underlying operation is always
an upsert on `(userId, today)`.

## Error Handling

- **Invalid field value** (sleep hours out of range, soreness/energy
  outside 1–5, or any required field missing): the whole submission is
  rejected; redirect back to `/checkin` with `error=invalid` and the
  submitted (invalid) values echoed in the query string, so the form
  redisplays exactly what the athlete entered rather than resetting to
  blank or to the last-saved values.
- **No ownership/authorization edge case**: unlike `/plan/[date]/[workoutId]/edit`,
  there's no row id in the URL to spoof — `upsertCheckin`/`getTodayCheckin`
  always operate on the signed-in user's own `(userId, today)` pair, so
  there's no cross-user access surface to guard against beyond the existing
  `getCurrentUserId()` sign-in check.
- **Unauthenticated request**: same as every other page/route in the app —
  redirect to `/sign-in`.

## Testing

- **Unit** (`parseCheckinForm`): a fully valid submission; each required
  field missing; sleep hours negative; sleep hours above 24; soreness/energy
  at the boundary values `0` and `6` (both invalid) and `1`/`5` (both
  valid); note trimming (whitespace-only note becomes `null`).
- **Integration** (real Postgres, existing `truncateAllTables`/`beforeEach`
  pattern): `upsertCheckin` creates a row when none exists for that
  `(userId, date)`; a second call for the same `(userId, date)` updates the
  existing row rather than creating a duplicate (verified via row count and
  via the updated field values); `getTodayCheckin` returns `null` when no
  row exists yet; results are scoped to the requesting user (a check-in
  belonging to another user for the same date is not returned).
- **Manual/exploratory**: submit today's check-in from a blank state;
  reload `/checkin` and confirm the just-submitted values are pre-filled;
  edit a field and re-submit, confirm the same row was updated (not
  duplicated); submit an invalid value (e.g. sleep hours of `30`) and
  confirm the form redisplays the entered values alongside an error
  message; confirm the "Check in" link appears in Week view's nav.
