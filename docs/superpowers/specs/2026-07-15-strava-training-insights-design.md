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
- Let an athlete add an upcoming race — including multi-leg races like
  duathlon/triathlon — and generate a periodized training plan leading up to
  it, refined week by week as real performance data comes in.
- Let an athlete browse their plan by week or by month, with race days
  visible alongside training days, not just the current week.

## Non-Goals (v1)

- Public / open signup — this is for a closed, invite-style friend group.
- Auto-applying AI suggestions without review.
- Push notifications (in-app + email only for v1).
- Actioning suggestions directly from the email (email links back into the app).
- Non-Strava data sources (e.g. manual GPX upload, other platforms).
- Merging two concurrent A-priority races into a single blended plan — the
  app flags the conflict and asks the athlete to pick one instead.

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
  and sends the daily summary email. A weekly pass (part of the same cron
  infrastructure) also refines the upcoming week's outline into a detailed
  daily plan for any athlete with an active race-driven plan.
- **AI**: Server-side calls to the Claude API (Claude Sonnet 5). Given
  planned-vs-actual data, recent trend, and check-in data, it returns a
  structured insight plus an optional proposed revision to tomorrow's plan.
  The same integration is reused by the race plan generator to flesh out a
  week's daily workouts from a phase + target volume (see Race Planning
  below) — periodization itself is deterministic, rule-based code, not an AI
  call.
- **Email**: A transactional email provider (e.g. Resend) sends the daily
  digest, linking back into the app for any action.
- **Calendar data**: `GET /api/plan?start=<date>&end=<date>` returns planned
  workouts, matched activities, and race markers for an inclusive date range.
  It's a single read path over existing tables (`planned_workouts`,
  `activities`, `race_events`) scoped by range — both Week view (a 7-day
  range) and Month view (the full 5–6 week visible grid) call the same
  endpoint rather than having separate data-fetching logic.

This keeps the whole system in one deployable unit — appropriate for a
small-group app with no need for independently scaled services.

## Data Model

- **users** — `id`, `strava_athlete_id`, `name`, `email`, `timezone`, Strava
  `access_token` / `refresh_token` / `expires_at` (encrypted at rest),
  `connection_status` (connected/disconnected), `weekly_availability`
  (structured: which days the athlete can train and roughly how long per
  day), `experience_level` (beginner/intermediate/advanced). The latter two
  are set once in profile settings, editable any time, and read by the race
  plan generator — not re-entered per race.
- **planned_workouts** — `id`, `user_id`, `date`, `sport`
  (run / trail_run / ride / mtb / swim / rest), `workout_type`
  (easy / tempo / interval / long / recovery / technique / rest),
  `target_duration_min`, `target_distance`, `target_metric`
  (pace / power / hr_zone), `target_value`, `notes`, `status`
  (planned / completed / skipped / pending_review / accepted / rejected /
  superseded), `source` (user / ai_suggested), `superseded_by` (nullable
  self-reference, set when an AI suggestion replaces this row — the original
  row's `status` becomes `superseded` at the same time), `training_block_id`
  (nullable, links a race-generated workout back to the week that produced
  it), `race_event_id` (nullable, set on the row representing race day
  itself).
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
- **race_events** — `id`, `user_id`, `name`, `date`, `priority` (A/B/C),
  `goal_time` (nullable), `course_notes` (nullable free text), `status`
  (upcoming / completed / cancelled).
- **race_legs** — `id`, `race_event_id`, `sport`
  (run / trail_run / ride / mtb / swim), `distance`, `order` (sequence within
  the race — e.g. leg 1 swim, leg 2 ride, leg 3 run for a triathlon; a
  single-sport race has one leg with `order=1`).
- **training_blocks** — `id`, `user_id`, `race_event_id`, `week_start_date`,
  `phase` (base / build / peak / taper / race_week), `target_volume` (weekly
  duration or distance target), `detail_status`
  (outline / pending_review / detailed). One row per week between now and
  the race, for the race currently driving the plan. A B/C race occurring
  inside an A-race's timeline does not get its own `training_blocks` rows —
  it's slotted into the driving block's week as a specific workout instead of
  restarting periodization.

The calendar (Week/Month browsing) introduces no new tables — it's a read
path over `planned_workouts`, `activities`, and `race_events` scoped by
whatever date range is currently visible, rather than always "today"/"this
week."

Activities are matched to a planned workout by same-day + same-sport. If no
match exists, the insight still generates — it just omits the "vs. plan"
comparison and comments on the activity and trend alone. If multiple planned
entries share a sport on the same day, the activity matches the most recent
unmatched one; the rest are left unmatched rather than guessed.

## Core Flows

**Plan authoring** — The athlete's Plan screen shows a day × sport × workout
grid, toggling between Week view (7 days, full detail) and Month view (a
browsable overview — see Calendar Navigation below). In Week view, clicking a
day opens a structured builder (sport, workout type, duration/distance,
target pace/power/HR zone, notes). Saved as a `planned_workouts` row with
`source=user`.

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

### Race Planning

**Add a race** — The athlete fills a form: name, date, one or more legs
(sport + distance each — multiple legs for duathlon/triathlon), priority
(A/B/C), optional goal time, and optional course notes. Saved as `upcoming`.
The nearest/highest-priority A-race becomes the plan-driving race.

**Generate plan** — The athlete taps "Generate training plan" on the race.
The engine:
1. Computes weeks-to-race and, using the race distance/sport and standard
   periodization heuristics, splits that span into base/build/peak/taper
   phases with a weekly target volume ramp (including cutback weeks) —
   deterministic, rule-based code, not an AI call.
2. Creates one `training_blocks` row per week with its phase and target
   volume, all at `detail_status=outline`.
3. Calls Claude once for the current week only, passing that week's phase and
   target volume, recent Strava history, stated availability, experience
   level, and the race's goal time/course notes — requesting a concrete
   day-by-day breakdown (sport, type, duration/distance, target metric) that
   fits the target volume.
4. If any of the current week's days already have manually authored
   workouts, the athlete first sees a summary ("This replaces 5 planned
   workouts this week") and can exclude specific days before confirming.
5. The proposed week is shown for review before it's written as the active
   plan (see Weekly refinement below for the review pattern).

**Weekly refinement** — Shortly before each upcoming week starts, the same
detail-generation step (step 3 above) runs for that week's outline, using the
latest Strava history/check-ins gathered so far. Unlike the daily tweak
(a single suggested workout linked from one `insights` row), this produces up
to seven `planned_workouts` rows at once — all `source=ai_suggested`,
`status=pending_review`, sharing the week's `training_block_id`. Review
happens at the week level: the athlete sees the full proposed week and can
accept it as a whole, edit individual days before accepting, or reject the
whole week (which leaves it as an outline the athlete can fill in manually).

**Daily adaptation still applies** — The existing daily insight/suggestion
flow (tweak tomorrow's workout) operates on top of whatever is currently
detailed for that day, race-generated or not — no change to that mechanism;
it now also has the race phase as extra context Claude can reference (e.g.
"since you're deep in your build phase, better to protect tomorrow's key
session").

**B/C race handling** — Adding a B/C race inside an existing A-race timeline
doesn't trigger new generation. When that week's detail step runs, the engine
passes the B/C race's date/goal as additional context so Claude can place a
race-effort or tune-up day around it rather than a conflicting hard session.

### Calendar Navigation

**Navigate by week/month** — `‹`/`›` controls shift a shared `focusedDate` by
7 days (Week view) or one calendar month (Month view), triggering a new
`GET /api/plan` call for the newly visible range. A "Today" shortcut resets
`focusedDate` to the current date in either mode.

**Switch Week ⇄ Month** — Toggling view mode keeps `focusedDate` fixed and
re-fetches for the new mode's range — Month view on a day in October,
switched to Week view, lands on the October week containing that day. No
jump to "today" on toggle.

**Month view** — A standard 7-column grid; leading/trailing days from
adjacent months render dimmed and unclickable. Each in-month day shows a
sport-dot with one of three fill states — completed, planned, or suggested
(awaiting review) — collapsing the full `planned_workouts.status` set down
for month-grid space: `accepted` displays as planned (it's the active plan),
`rejected`/`superseded` display as whatever status the row that stands in
their place has. A distinct race marker appears on any day matching a
`race_event_id`.

**Click a day cell (Month view)** — Switches to Week view with `focusedDate`
set to that day, showing its full week. (Dimmed adjacent-month fillers are
unclickable; navigating `›` to that month is how you actually reach them.)

**Click a day row (Week view)** — Unchanged for today/future: opens the
builder. For any day strictly before today: opens a read-only detail view
(same information, no editable fields) instead — history reflects what
Strava actually synced and what insights were generated against, and isn't
retroactively rewritten.

**Race markers** — Clicking a race day (past or future, either view)
navigates to the Races tab and scrolls to that race's card, rather than
opening the day builder — races are edited from the Races tab, not the
calendar.

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
- **Race date too close for full periodization** (e.g. race is in 5 days):
  the engine generates what it can — skips base/build/peak and treats the
  remaining time as taper/race-week — rather than failing outright.
- **Not enough Strava history to gauge fitness** (new user, few synced
  activities): falls back to the stated experience level as the primary
  signal for starting volume, and says so in the generated week's rationale
  so the athlete knows it's a rougher estimate.
- **Claude fails to return a usable week** during generation or weekly
  refinement: the week stays at `detail_status=outline` (or keeps last week's
  detailed plan if refinement failed), retried on the next daily cron pass —
  the same non-blocking pattern as insight-generation failures.
- **Athlete cancels a race mid-plan**: its `training_blocks` rows are marked
  cancelled; already-detailed planned workouts already written to the grid
  are left as-is (the athlete's own plan now) rather than retroactively
  deleted.
- **Overlapping A-races**: if the athlete marks a second race as A-priority
  while one is already driving the plan, the app flags the conflict and asks
  the athlete to demote one to B/C or choose which drives the plan — it does
  not attempt to merge two peak/taper arcs.
- **Empty calendar range** (a far-future or far-past month with no data yet):
  renders the grid normally with all days empty — not an error, just nothing
  scheduled there yet.
- **`/api/plan` fetch failure on navigation**: keep showing the previously
  loaded range with an inline retry affordance, rather than clearing the view
  to blank on a transient network error.
- **Rapid navigation** (clicking `›` repeatedly before a fetch resolves):
  each request carries the range it was for; only the response matching the
  *current* `focusedDate`/range is applied, so a slow earlier response can't
  overwrite a newer one the athlete has already navigated past.
- **Race marker for a since-removed race**: falls back to showing the day's
  regular training content instead of erroring, since the marker is just a
  join against current `race_events`.

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
- **Unit tests (race planning)**: periodization heuristics (phase lengths and
  volume ramp for a range of weeks-to-race and race distances, including a
  race next week and a season-long 26-week block), the B/C-race slotting
  logic, and the conflict-summary builder ("This replaces N planned
  workouts").
- **Integration tests (race planning)**: full generate-plan flow against a
  mocked Claude response (race saved → blocks created → current week
  detailed → conflict summary shown → confirm → workouts written); the
  weekly refinement job picking up the next outline week and generating its
  detail.
- **Manual/exploratory (race planning)**: adding a multi-leg triathlon race,
  generating a plan with an existing partially-filled week to see the
  conflict summary, and walking through a full base→build→peak→taper arc for
  a marathon-length plan to sanity-check the phase pacing reads naturally.
- **Unit tests (calendar)**: month-grid generation (correct leading/trailing
  days for months starting/ending mid-week, leap-year February),
  `focusedDate` step math for week/month navigation, and the past/future
  read-only boundary (today itself must stay editable, not read-only).
- **Integration tests (calendar)**: `GET /api/plan` range queries against
  seeded data (a week range, a full month-grid range, a range spanning two
  months); the stale-response race condition where a slow request for an old
  range resolves after a newer one.
- **Manual/exploratory (calendar)**: navigating several months forward and
  back, switching Week⇄Month mid-browse and confirming the date carries
  over, clicking a race marker from Month view, and confirming a past day
  opens read-only while today/future still opens the builder.
