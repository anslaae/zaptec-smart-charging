import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  integer,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const scheduleStatus = pgEnum("schedule_status", [
  "pending",
  "active",
  "completed",
  "cancelled",
]);

export const chargeSchedules = pgTable("charge_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.id),
  chargerId: text("charger_id").notNull(),
  chargerName: text("charger_name").notNull(),
  targetEnergyKwh: numeric("target_energy_kwh", {
    precision: 6,
    scale: 2,
  }).notNull(),
  readyBy: timestamp("ready_by", { withTimezone: true }).notNull(),
  status: scheduleStatus("status").notNull().default("pending"),
  lastCommand: text("last_command"),
  lastNote: text("last_note"),
  lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
  lastError: text("last_error"),
  // When the scheduler first resumed charging for this schedule.
  startedAt: timestamp("started_at", { withTimezone: true }),
  // When the schedule reached a terminal state (completed or cancelled).
  endedAt: timestamp("ended_at", { withTimezone: true }),
  // The real Zaptec session active at the moment charging started -- lets
  // the history page link back to the real session's actual energy/duration
  // via getChargeHistory().
  zaptecSessionId: text("zaptec_session_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One row per command the scheduler decides to send (resume/pause/complete)
// -- an internal log of what the scheduler actually did over time, not just
// the latest state.
export const scheduleActions = pgTable("schedule_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  scheduleId: uuid("schedule_id")
    .notNull()
    .references(() => chargeSchedules.id, { onDelete: "cascade" }),
  chargerId: text("charger_id").notNull(),
  action: text("action").notNull(),
  commandId: integer("command_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const chargeSessions = pgTable("charge_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  chargerId: text("charger_id").notNull(),
  zaptecSessionId: text("zaptec_session_id"),
  scheduleId: uuid("schedule_id").references(() => chargeSchedules.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  energyKwh: numeric("energy_kwh", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Single row ("singleton"), upserted on every scheduler tick regardless of
// whether there were any schedules to act on -- lets the UI show whether the
// external cron (cron-job.org) is actually still calling /api/cron/tick.
export const schedulerHeartbeat = pgTable("scheduler_heartbeat", {
  id: text("id").primaryKey(),
  lastTickAt: timestamp("last_tick_at", { withTimezone: true }).notNull(),
});

// One row per charger, holding only the last operationMode the tick saw --
// purely bookkeeping to detect a *change* (plugged in, started charging,
// ...) worth logging to activityEvents. Not surfaced in the UI directly.
export const chargerObservedState = pgTable("charger_observed_state", {
  chargerId: text("charger_id").primaryKey(),
  operationMode: integer("operation_mode"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// A plain chronological log of everything worth showing on the history
// page's "Activity" list -- both physical events we observe (plugged in,
// charging started/stopped) and things this app did (manual start/stop, plan
// created/cancelled/completed, an unplanned session we stopped). `type` is a
// free-text key from src/lib/activity/log.ts rather than a DB enum, so adding
// a new kind of event later doesn't need a migration.
export const activityEvents = pgTable("activity_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  chargerId: text("charger_id").notNull(),
  chargerName: text("charger_name").notNull(),
  type: text("type").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Tracks a manual "Start charging" click as an open-ended authorization --
// the scheduler tick treats a charger as legitimately charging while one of
// these is open for it, same as an active schedule. Closed when the car
// disconnects or someone presses "Stop charging".
export const manualChargeSessions = pgTable("manual_charge_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  chargerId: text("charger_id").notNull(),
  startedByUserId: uuid("started_by_user_id")
    .notNull()
    .references(() => users.id),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
