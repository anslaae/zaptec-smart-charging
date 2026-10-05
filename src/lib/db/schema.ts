import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  integer,
  boolean,
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
  // When true, the scheduler logs start/stop decisions instead of sending
  // real commands to the charger. See the schedule_actions table for a log
  // of what was (or would have been) sent.
  simulate: boolean("simulate").notNull().default(false),
  lastCommand: text("last_command"),
  lastNote: text("last_note"),
  lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
  lastError: text("last_error"),
  // When the scheduler first resumed (or, if simulate, would have resumed)
  // charging for this schedule.
  startedAt: timestamp("started_at", { withTimezone: true }),
  // When the schedule reached a terminal state (completed or cancelled).
  endedAt: timestamp("ended_at", { withTimezone: true }),
  // The real Zaptec session active at the moment charging started, captured
  // only for non-simulated schedules — lets the history page link back to
  // the real session's actual energy/duration via getChargeHistory(). Null
  // for simulated schedules, since no real session was ever triggered.
  zaptecSessionId: text("zaptec_session_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One row per command the scheduler decides to send (resume/pause/complete),
// whether real or simulated — lets the history page show what the scheduler
// actually did (or would have done) over time, not just the latest state.
export const scheduleActions = pgTable("schedule_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  scheduleId: uuid("schedule_id")
    .notNull()
    .references(() => chargeSchedules.id),
  chargerId: text("charger_id").notNull(),
  action: text("action").notNull(),
  commandId: integer("command_id").notNull(),
  simulated: boolean("simulated").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const chargeSessions = pgTable("charge_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  chargerId: text("charger_id").notNull(),
  zaptecSessionId: text("zaptec_session_id"),
  scheduleId: uuid("schedule_id").references(() => chargeSchedules.id),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  energyKwh: numeric("energy_kwh", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
