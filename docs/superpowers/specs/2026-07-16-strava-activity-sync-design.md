# Strava Activity Sync — Design

**Date**: 2026-07-16
**Status**: Approved for planning

## Summary

Syncs completed Strava activities into the app for each connected athlete, via
a Strava webhook (real-time) backed by a daily cron reconciliation (catches
anything the webhook missed). Synced activities are matched to that day's
planned workout where possible. This is the "Activity sync" flow from
`docs/superpowers/specs/2026-07-15-strava-training-insights-design.md`,
scoped to storage + matching only — it stops short of triggering AI insight
generation, which is a separate later plan.

## Non-Goals (this plan)

- Insight/suggestion generation (Claude calls, email digest) — a later plan
  consumes the activities this plan stores.
- Strava webhook *subscription* creation (the one-time `POST` to Strava's API
  registering our callback URL) — that requires a public deployed URL and is
  a manual one-time operational step, documented but not code in this plan.
  This plan builds the receiver Strava calls, not the registration call we'd
  make to Strava.
- Handling `update`/`delete` webhook events beyond acknowledging them —
  `create` is the only aspect type that triggers sync logic.
- Full dashboard/plan UI — the reconnect banner is the only UI surface this
  plan touches, since no other authenticated screen exists yet.

## Architecture

Builds on the existing Strava OAuth + session foundation
(`lib/strava.ts`, `lib/users.ts`, `lib/crypto.ts`, `db/schema.ts`).

- **`lib/strava-client.ts`** — new. Wraps `lib/strava.ts`'s token functions
  with `authenticatedStravaFetch(user, path)`: makes the request with the
  user's decrypted access token; on a `401`, calls `refreshStravaToken`,
  persists the new encrypted tokens via a `users.ts` update helper, and
  retries once. If the refresh call itself fails, sets
  `connectionStatus='disconnected'` and rethrows. Exposes `getActivity(user,
  stravaActivityId)` and `listActivities(user, after: Date)`.
- **`lib/activity-sync.ts`** — new. `syncActivity(stravaAthleteId,
  stravaActivityId)`: looks up the local user by `strava_athlete_id`
  (skips if not found or disconnected), fetches the full activity, maps
  Strava's `sport_type` to the local `activity_sport` enum (unmapped types
  store as `other`), inserts the `activities` row (`onConflictDoNothing` on
  `strava_activity_id` for idempotency across webhook + cron double-delivery),
  then calls the matcher.
- **`lib/activity-matching.ts`** — new. `matchActivity(activity, candidateWorkouts)`:
  pure function, same-day + same-sport, most-recent-unmatched wins on
  multiple candidates, ties left unmatched. Caller updates the matched
  `planned_workouts` row to `status='completed'` and sets
  `matched_planned_workout_id`.
- **`app/api/strava/webhook/route.ts`** — new. `GET` answers Strava's
  subscription-verification handshake (`hub.mode`, `hub.challenge`,
  `hub.verify_token` checked against `STRAVA_WEBHOOK_VERIFY_TOKEN`, responds
  `{"hub.challenge": ...}`). `POST` responds `200` immediately (Strava
  requires a fast ack), then for `object_type='activity'` +
  `aspect_type='create'` calls `syncActivity(owner_id, object_id)`;
  `update`/`delete` and non-activity events are acknowledged and no-op'd.
  Errors during processing are logged, not retried inline — the reconciliation
  cron is the retry path.
- **`app/api/cron/reconcile-activities/route.ts`** — new. `GET`, checks the
  standard Vercel cron auth header against `CRON_SECRET`. For every user with
  `connection_status='connected'`, calls `listActivities(user, after: now -
  2 days)` and runs `syncActivity` for each returned activity ID (the
  `onConflictDoNothing` insert makes already-synced activities a no-op).
- **`vercel.json`** — new/updated. Adds a daily cron schedule entry for the
  reconcile route.
- **Reconnect banner** — a small addition to `app/page.tsx`: when the signed-in
  user's `connectionStatus === 'disconnected'`, shows a banner linking to
  `/api/auth/login` to re-authorize.

## Data Model Changes

- `activity_sport` enum (in `db/schema.ts`) gains an `'other'` value, for
  Strava activity types outside the app's five supported sports (e.g. Hike,
  Walk, WeightTraining, Yoga). These are stored (full history is kept) but
  never participate in plan matching, since no planned-workout sport can be
  `other`.
- New env vars: `STRAVA_WEBHOOK_VERIFY_TOKEN` (our secret, checked during the
  Strava handshake), `CRON_SECRET` (Vercel's standard cron-auth convention).
- No new tables. `activities` and `users.connection_status` (both already in
  the schema) cover this feature.

## Error Handling

- **Token expiry/revocation**: `authenticatedStravaFetch` refreshes
  automatically on `401`. If the refresh call fails, the user is marked
  `disconnected` and the reconciliation cron skips them until they
  re-authorize (banner links back to `/api/auth/login`).
- **Webhook delivery gaps**: the daily reconciliation cron independently pulls
  each connected user's last-2-days activity list and syncs anything missing
  — webhook delivery is not assumed reliable.
- **Duplicate delivery** (webhook fires twice, or webhook and cron both see
  the same activity): the existing unique constraint on `strava_activity_id`
  plus `onConflictDoNothing` makes the insert idempotent; no double-processing.
  A duplicate that was already matched is not re-matched.
- **No matching planned workout**: not an error — the activity is stored
  unmatched; a later plan's insight generation handles the "no plan to
  compare to" case.
- **Ambiguous same-day multi-sport activities**: `matchActivity` matches the
  most recent unmatched candidate; other same-sport/same-day rows are left
  unmatched rather than guessed.
- **Unmapped Strava sport type**: stored with `sport='other'`; never matched.
- **`update`/`delete` webhook events**: acknowledged with `200`, no processing.
- **Webhook processing failure** (e.g. Strava API error mid-fetch): logged;
  the webhook response was already sent `200` so Strava won't retry, but the
  reconciliation cron picks it up on its next pass.
- **Reconciliation cron failure for one user**: doesn't block processing of
  other users — each user's sync is independently caught and logged.

## Testing

- **Unit**: Strava `sport_type` → `activity_sport` mapping (including
  unmapped → `other`); `matchActivity` (same-day/same-sport match, multi-
  candidate most-recent-unmatched tie-break, no-candidate case);
  `authenticatedStravaFetch`'s 401-refresh-and-retry behavior and its
  refresh-failure → disconnected path (mocked `fetch`).
- **Integration** (real Postgres, following the existing
  global-setup/migration/truncation pattern): webhook `POST` end-to-end
  against a mocked Strava API — activity created → fetched → stored →
  matched, with the matched `planned_workouts` row flipping to `completed`;
  webhook `GET` handshake verification (correct token accepted, wrong token
  rejected); reconciliation route catching an activity a simulated missed
  webhook never delivered; duplicate delivery (same activity via webhook then
  cron) resulting in exactly one stored row.
