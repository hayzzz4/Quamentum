# Strava Training Insights WebApp — Design

**Date**: 2026-07-15
**Status**: Approved for planning

## Summary

A webapp for a small group of athletes (the user + a few training partners) that
authors weekly training plans, syncs completed activities from Strava, and uses
Claude to generate a daily insight comparing planned vs. actual performance —
optionally proposing a tweak to tomorrow's planned workout, which the athlete
reviews and accepts, edits, or rejects.

## Goals

- Let each athlete plan a training week across five sports: Running, Trail
  Running, Cycling, Mountain Biking, Swimming.
- Automatically pull in completed Strava activities for each connected athlete.
- Generate a daily AI insight explaining today's performance against the plan,
  informed by recent trend and how the athlete says they feel.
- Propose an adjustment to tomorrow's workout when warranted, with the athlete
  always in control of whether it's applied.

## Non-Goals (v1)

- Public / open signup — this is for a closed, invite-style friend group.
- Auto-applying AI suggestions without review.
- Push notifications (in-app + email only for v1).
- Actioning suggestions directly from the email (email links back into the app).
- Non-Strava data sources (e.g. manual GPX upload, other platforms).

## Audience

The user plus a small number of training partners, each with their own Strava
account. Not a public product — no self-serve signup beyond "Sign in with
Strava."

## Architecture

- **Stack**: Next.js (TypeScript) full-stack app — React frontend and API
  routes in a single codebase, deployed to Vercel.
- **Database**: Postgres (Supabase or Neon) — users, Strava tokens, weekly
  plans, activities, daily check-ins, AI insights/suggestions.
- **Auth**: "Sign in with Strava" (OAuth) is the login itself — no separate
  password. A session cookie is issued after the OAuth callback; the athlete's
  Strava `athlete.id` is their identity in the app.
- **Strava sync**: One Strava API application (shared across the friend group)
  holds a single webhook subscription. Strava posts to
  `/api/strava/webhook` whenever a connected athlete uploads an activity. The
  handler resolves the local user from the athlete ID in the payload, fetches
  the full activity via the Strava API, and stores it.
- **Scheduled work**: Vercel Cron runs a daily job that generates insights and
  suggestions for any user with new data since their last processed insight,
  and sends the daily summary email.
- **AI**: Server-side calls to the Claude API (Claude Sonnet 5). Given
  planned-vs-actual data, recent trend, and check-in data, it returns a
  structured insight plus an optional proposed revision to tomorrow's plan.
- **Email**: A transactional email provider (e.g. Resend) sends the daily
  digest, linking back into the app for any action.

This keeps the whole system in one deployable unit — appropriate for a
small-group app with no need for independently scaled services.

## Data Model

- **users** — `id`, `strava_athlete_id`, `name`, `email`, `timezone`, Strava
  `access_token` / `refresh_token` / `expires_at` (encrypted at rest),
  `connection_status` (connected/disconnected).
- **planned_workouts** — `id`, `user_id`, `date`, `sport`
  (run / trail_run / ride / mtb / swim / rest), `workout_type`
  (easy / tempo / interval / long / recovery / technique / rest),
  `target_duration_min`, `target_distance`, `target_metric`
  (pace / power / hr_zone), `target_value`, `notes`, `status`
  (planned / completed / skipped / pending_review / accepted / rejected /
  superseded), `source` (user / ai_suggested), `superseded_by` (nullable
  self-reference, set when an AI suggestion replaces this row — the original
  row's `status` becomes `superseded` at the same time).
- **activities** — `id`, `user_id`, `strava_activity_id`, `date`, `sport`,
  `duration`, `distance`, `avg_hr`, `avg_pace_or_power`, `relative_effort`
  (Strava's effort score, if available), raw payload snapshot,
  `matched_planned_workout_id` (nullable).
- **checkins** — `id`, `user_id`, `date`, `sleep_hours`, `soreness` (1–5),
  `energy` (1–5), optional free-text note.
- **insights** — `id`, `user_id`, `date`, `activity_id` (nullable),
  commentary text, `suggested_workout_id` (nullable, points to a
  `planned_workouts` row with `source=ai_suggested`), `status`
  (pending / accepted / edited / rejected).

Activities are matched to a planned workout by same-day + same-sport. If no
match exists, the insight still generates — it just omits the "vs. plan"
comparison and comments on the activity and trend alone. If multiple planned
entries share a sport on the same day, the activity matches the most recent
unmatched one; the rest are left unmatched rather than guessed.

## Core Flows

**Plan authoring** — The athlete opens a weekly grid view (day × sport ×
workout). Clicking a day opens a structured builder (sport, workout type,
duration/distance, target pace/power/HR zone, notes). Saved as a
`planned_workouts` row with `source=user`.

**Activity sync** — Strava webhook fires → handler resolves the local user
from `strava_athlete_id` → fetches full activity details from the Strava API
→ stores as an `activities` row → attempts same-day/same-sport match to a
`planned_workouts` row. On a successful match, the matched plan row's
`status` is set to `completed`.

**Daily check-in** — A simple prompt (sleep, soreness, energy, optional note)
the athlete fills once a day, independent of activity sync.

**Insight + suggestion generation** — Triggered by a webhook-driven sync or
by the daily cron sweep (which also catches anything a live trigger missed).
For each user with new data since their last processed insight:
1. Gather context: today's activity (if any) + matched plan, the last
   1–2 weeks of activities/plans for trend, today's and recent check-ins, and
   tomorrow's currently planned workout.
2. Send this as structured context to Claude, requesting (a) a short
   natural-language insight on today's performance vs. plan, and (b) an
   optional suggested revision to tomorrow's planned workout with reasoning —
   only when a change is warranted.
3. Store the insight. If a suggestion was returned, create a new
   `planned_workouts` row (`source=ai_suggested`, `status=pending_review`)
   linked from the insight; the original plan row is left untouched.

**Review suggestion** — The athlete sees the insight and suggestion in-app and
via email.
- Accept → the suggested row becomes the active plan for that day; the
  original is marked `superseded_by` the new row.
- Edit → the athlete adjusts fields inline, then accepts.
- Reject → the suggested row is marked `rejected`; the original plan stands.

**Email** — The daily digest email summarizes the insight and links back into
the app for any accept/edit/reject action. The write path stays centralized in
the app; email is notification-only.

## Error Handling

- **Strava token expiry/revocation**: Refresh automatically on a 401 from the
  Strava API. If the refresh itself fails (access revoked), mark the user
  `disconnected`, stop syncing for them, and show a reconnect banner in-app.
- **Webhook delivery gaps**: Webhooks are not guaranteed reliable. The daily
  cron job also reconciles — pulling each connected user's activity list for
  the last 2 days and inserting anything the webhook missed.
- **Claude API failures/timeouts**: Store the pending activity/check-in as
  unprocessed, retry once on the next cron pass. If it still fails, surface
  the raw planned-vs-actual data in-app without AI commentary rather than
  blocking the athlete from seeing their data.
- **No matching planned workout**: Not an error — insight generation still
  runs, commenting on the activity and trend without a plan comparison.
- **Ambiguous same-day multi-sport activities**: Match by sport; if several
  planned entries share a sport on the same day, match the most recent
  unmatched entry and leave the rest unmatched.
- **Email delivery failure**: Non-blocking. The in-app insight is the source
  of truth; email failures are logged but not aggressively retried.

## Testing

- **Unit tests**: plan/activity matching logic (including same-day
  multi-sport edge cases), Strava token refresh logic, and the insight-request
  payload builder (what context is sent to Claude).
- **Integration tests**: webhook handler end-to-end against a mocked Strava
  API (activity created → fetched → stored → matched); cron reconciliation
  catching a simulated missed webhook.
- **AI output handling**: since Claude's output isn't deterministic, tests
  validate the response *contract* (parses into the expected structured shape
  — insight text + optional suggestion fields) using mocked Claude responses,
  not the quality of the generated text.
- **Manual/exploratory**: accept/edit/reject flow for suggestions, Strava
  OAuth connect/disconnect/reconnect flow, and the weekly grid UI across all
  five sports.
