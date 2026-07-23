import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  date,
  jsonb,
  bigint,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const connectionStatusEnum = pgEnum('connection_status', ['connected', 'disconnected']);
export const experienceLevelEnum = pgEnum('experience_level', ['beginner', 'intermediate', 'advanced']);
export const workoutSportEnum = pgEnum('workout_sport', ['run', 'trail_run', 'ride', 'mtb', 'swim', 'rest']);
export const activitySportEnum = pgEnum('activity_sport', ['run', 'trail_run', 'ride', 'mtb', 'swim', 'other']);
export const workoutTypeEnum = pgEnum('workout_type', [
  'easy', 'tempo', 'interval', 'long', 'recovery', 'technique', 'rest',
]);
export const targetMetricEnum = pgEnum('target_metric', ['pace', 'power', 'hr_zone']);
export const workoutStatusEnum = pgEnum('workout_status', [
  'planned', 'completed', 'skipped', 'pending_review', 'accepted', 'rejected', 'superseded',
]);
export const workoutSourceEnum = pgEnum('workout_source', ['user', 'ai_suggested']);
export const insightStatusEnum = pgEnum('insight_status', ['pending', 'accepted', 'edited', 'rejected']);
export const racePriorityEnum = pgEnum('race_priority', ['A', 'B', 'C']);
export const raceStatusEnum = pgEnum('race_status', ['upcoming', 'completed', 'cancelled']);
export const trainingPhaseEnum = pgEnum('training_phase', ['base', 'build', 'peak', 'taper', 'race_week']);
export const detailStatusEnum = pgEnum('detail_status', ['outline', 'pending_review', 'detailed']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  stravaAthleteId: bigint('strava_athlete_id', { mode: 'number' }).notNull().unique(),
  name: text('name').notNull(),
  // Nullable: Strava's OAuth response never includes an email address.
  // Filled in via the /onboarding/email step right after first login.
  email: text('email').unique(),
  timezone: text('timezone').notNull().default('UTC'),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  connectionStatus: connectionStatusEnum('connection_status').notNull().default('connected'),
  weeklyAvailability: jsonb('weekly_availability').$type<
    Record<string, { available: boolean; minutes: number }>
  >(),
  experienceLevel: experienceLevelEnum('experience_level'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const raceEvents = pgTable('race_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  date: date('date', { mode: 'date' }).notNull(),
  priority: racePriorityEnum('priority').notNull(),
  goalTime: text('goal_time'),
  courseNotes: text('course_notes'),
  status: raceStatusEnum('status').notNull().default('upcoming'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const raceLegs = pgTable('race_legs', {
  id: uuid('id').defaultRandom().primaryKey(),
  raceEventId: uuid('race_event_id').notNull().references(() => raceEvents.id),
  sport: activitySportEnum('sport').notNull(),
  distance: numeric('distance', { precision: 7, scale: 2 }).notNull(),
  legOrder: integer('leg_order').notNull(),
});

export const trainingBlocks = pgTable('training_blocks', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  raceEventId: uuid('race_event_id').notNull().references(() => raceEvents.id),
  weekStartDate: date('week_start_date', { mode: 'date' }).notNull(),
  phase: trainingPhaseEnum('phase').notNull(),
  targetVolume: numeric('target_volume', { precision: 7, scale: 2 }).notNull(),
  detailStatus: detailStatusEnum('detail_status').notNull().default('outline'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const plannedWorkouts = pgTable('planned_workouts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  date: date('date', { mode: 'date' }).notNull(),
  sport: workoutSportEnum('sport').notNull(),
  workoutType: workoutTypeEnum('workout_type').notNull(),
  targetDurationMin: integer('target_duration_min'),
  targetDistance: numeric('target_distance', { precision: 7, scale: 2 }),
  targetMetric: targetMetricEnum('target_metric'),
  targetValue: text('target_value'),
  notes: text('notes'),
  status: workoutStatusEnum('status').notNull().default('planned'),
  source: workoutSourceEnum('source').notNull().default('user'),
  supersededBy: uuid('superseded_by').references((): AnyPgColumn => plannedWorkouts.id),
  trainingBlockId: uuid('training_block_id').references(() => trainingBlocks.id),
  raceEventId: uuid('race_event_id').references(() => raceEvents.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const activities = pgTable('activities', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  stravaActivityId: bigint('strava_activity_id', { mode: 'number' }).notNull().unique(),
  date: date('date', { mode: 'date' }).notNull(),
  sport: activitySportEnum('sport').notNull(),
  duration: integer('duration').notNull(),
  distance: numeric('distance', { precision: 7, scale: 2 }),
  avgHr: integer('avg_hr'),
  avgPaceOrPower: text('avg_pace_or_power'),
  relativeEffort: integer('relative_effort'),
  rawPayload: jsonb('raw_payload').notNull(),
  matchedPlannedWorkoutId: uuid('matched_planned_workout_id').references(() => plannedWorkouts.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const checkins = pgTable(
  'checkins',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id),
    date: date('date', { mode: 'date' }).notNull(),
    sleepHours: numeric('sleep_hours', { precision: 4, scale: 2 }),
    soreness: integer('soreness'),
    energy: integer('energy'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('checkins_user_date_unique').on(table.userId, table.date)],
);

export const insights = pgTable('insights', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  date: date('date', { mode: 'date' }).notNull(),
  activityId: uuid('activity_id').references(() => activities.id),
  commentary: text('commentary').notNull(),
  suggestedWorkoutId: uuid('suggested_workout_id').references(() => plannedWorkouts.id),
  status: insightStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
export type PlannedWorkout = typeof plannedWorkouts.$inferSelect;
export type ActivitySport = (typeof activitySportEnum.enumValues)[number];
export type RaceEvent = typeof raceEvents.$inferSelect;
export type Checkin = typeof checkins.$inferSelect;
