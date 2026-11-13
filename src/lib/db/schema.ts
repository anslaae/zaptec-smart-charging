import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  integer,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  real,
  boolean,
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
  // Null for Smart lading rows (source = 'smart'): the tick made them, not a person.
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  // 'user' = a plan someone made; 'smart' = Smart lading (UC16), one per plug-in session.
  source: text("source").notNull().default("user"),
  // Smart lading: the planned charging blocks + the kW they assume (see scheduler/smart.ts).
  blocks: jsonb("blocks"),
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
  // D67 Forvarm while this plan/Smart row is charging: until then the tick
  // won't pause or stop it (the earlier of 60 min from the tap and readyBy).
  // Only counts for the plug-in it was set in (see scheduler/preheatHold.ts).
  preheatHoldUntil: timestamp("preheat_hold_until", { withTimezone: true }),
  // D68: during the hold, since when the car hasn't drawn power (null while it
  // does) and when the "på batteriet" push went out (once per hold).
  preheatPowerLostAt: timestamp("preheat_power_lost_at", { withTimezone: true }),
  preheatPowerLostNotifiedAt: timestamp("preheat_power_lost_notified_at", { withTimezone: true }),
  // When the schedule reached a terminal state (completed or cancelled).
  endedAt: timestamp("ended_at", { withTimezone: true }),
  // The real Zaptec session active at the moment charging started -- lets
  // the history page link back to the real session's actual energy/duration
  // via getChargeHistory().
  zaptecSessionId: text("zaptec_session_id"),
  // Predicted charging duration (minutes), captured once at the moment
  // charging actually starts (estimateChargingPlan()'s remainingKwh/powerKw
  // at that instant) -- compared against the real duration once the plan
  // completes, see src/lib/scheduler/accuracy.ts. Null for schedules created
  // before this existed, and for ones that never actually started charging.
  estimatedDurationMinutes: integer("estimated_duration_minutes"),
  // estimateChargingPlan()'s remainingKwh, captured at the same moment as
  // estimatedDurationMinutes above -- kept separately so that once the
  // schedule completes, (remainingKwhAtStart / actual duration) gives the
  // real-world charge rate for that session, used to learn a better power
  // estimate than the circuit's theoretical max (see powerHistory.ts).
  remainingKwhAtStart: numeric("remaining_kwh_at_start", {
    precision: 6,
    scale: 2,
  }),
  // Zaptec resets sessionEnergyKwh to 0 when the car is unplugged and
  // replugged (a new session starts), so without this a disconnect mid-plan
  // would make the completion check think almost nothing had been
  // delivered and re-charge the full target from scratch. priorSessionEnergyKwh
  // is the running total from sessions that have already ended under this
  // schedule; lastObservedSessionEnergyKwh is the most recent reading for
  // whichever session zaptecSessionId currently points at, carried forward
  // into priorSessionEnergyKwh the moment a new session is observed. See
  // reconcileSessionEnergy() in engine.ts.
  priorSessionEnergyKwh: numeric("prior_session_energy_kwh", {
    precision: 6,
    scale: 2,
  }),
  lastObservedSessionEnergyKwh: numeric("last_observed_session_energy_kwh", {
    precision: 6,
    scale: 2,
  }),
  // What the plan sheet was set to, in battery % (the redesign plans in %,
  // the scheduler still works in kWh: targetEnergyKwh = (target - start) x
  // capacity). Null for plans made before the redesign.
  startPercent: integer("start_percent"),
  targetPercent: integer("target_percent"),
  // Which car the plan is for (null = the location's default car; one car today).
  carId: uuid("car_id").references(() => cars.id),
  // Once-per-plan push notifications (notifications.nb.json "proposed" events).
  lateNotifiedAt: timestamp("late_notified_at", { withTimezone: true }),
  waitingNotifiedAt: timestamp("waiting_notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  // Smart lading: one row per plug-in session, even if two ticks overlap (smartRun.ts).
  uniqueIndex("charge_schedules_smart_session_unique")
    .on(t.chargerId, t.zaptecSessionId)
    .where(sql`${t.source} = 'smart'`),
]);

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

// D69: the charger's raw state, one row whenever something meaningful
// changes (mode, final stop, session, power > 0.3 kW, a phase crossing
// 0.5 A) -- not every minute. For diagnosing what the car/charger actually
// did (e.g. the 13 Nov Forvarm on battery). Rows older than 30 days are
// pruned by the tick.
export const chargerStateLog = pgTable(
  "charger_state_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chargerId: text("charger_id").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    operationMode: integer("operation_mode"),
    powerKw: numeric("power_kw", { precision: 6, scale: 2 }),
    phase1Amps: real("phase1_amps"),
    phase2Amps: real("phase2_amps"),
    phase3Amps: real("phase3_amps"),
    finalStopActive: boolean("final_stop_active"),
    sessionId: text("session_id"),
    // Every observation as reported (stateId -> ValueAsString).
    raw: jsonb("raw"),
  },
  (t) => [index("charger_state_log_charger_observed").on(t.chargerId, t.observedAt)],
);

// D72: every Zaptec session as Zaptec itself closed it -- CompletedSession
// (observation 723), recorded by the tick when a session ends. Exact final
// energy, plus the charger's signed meter readings (OCMF: begin, every whole
// hour, end) that make Historikk/Innsikt's cost per hour exact. Keyed by
// Zaptec's session id, so a re-read never duplicates.
export const zaptecSessions = pgTable(
  "zaptec_sessions",
  {
    id: text("id").primaryKey(),
    chargerId: text("charger_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    energyKwh: numeric("energy_kwh", { precision: 8, scale: 3 }).notNull(),
    // [{ at: ISO, kwh: meter register }], oldest first; null when Zaptec sent none.
    meterReadings: jsonb("meter_readings"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("zaptec_sessions_charger_started").on(t.chargerId, t.startedAt)],
);

// D75: an unexpected stop while charging was asked for -- one row per
// incident, kept up to date by the tick and read by Hjem, so both phones show
// the same card and at most one push goes out. kind: "car" (the car stopped
// taking power), "start_failed" (D64), "offline", "locked" (D65 / Zaptec's
// restart lock), "charger_warning" (D73). subject: "session:<row id>",
// "schedule:<id>" or "charger" (the loop guard). since = when the condition
// was first seen; the card shows once the rules say so (src/lib/incidents/rules.ts).
export const chargeIncidents = pgTable(
  "charge_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chargerId: text("charger_id").notNull(),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    since: timestamp("since", { withTimezone: true }).notNull(),
    // Values for the push / activity line, saved when it went out (percent, kWh, warning text, ...).
    detail: jsonb("detail"),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    retriedAt: timestamp("retried_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("charge_incidents_one_open").on(t.chargerId).where(sql`${t.closedAt} is null`),
    index("charge_incidents_subject").on(t.subject),
  ],
);

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
  // Who did it, for the events a person actually triggered (manual
  // start/stop, plan created/cancelled). Null for events nobody "did" --
  // physical transitions the tick observed, or the scheduler/enforcement
  // acting on its own (plan completed, stopped an unplanned session).
  userId: uuid("user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Tracks a manual "Start charging" click as an open-ended authorization --
// the scheduler tick treats a charger as legitimately charging while one of
// these is open for it, same as an active schedule. Closed when the car
// disconnects or someone presses "Stop charging".
//
// `kind` says what opened it: "manual" (Lad nå), "preheat" (Forvarm),
// "guest" (Lån ut laderen, UC15 -- lasts until the car is unplugged) or
// "automatic" (opened by the tick for an unplanned plug-in while "Tillat
// automatisk lading" is on, UC14 -- no person behind it). The energy columns
// let Historikk show what each session delivered without the deprecated
// Zaptec charge-history API: the session counter at open, the latest reading
// while open (updated by the tick), and the delivered total once closed.
export const manualChargeSessions = pgTable("manual_charge_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  chargerId: text("charger_id").notNull(),
  kind: text("kind").notNull().default("manual"),
  // Guest windows: "Hvem låner?" (optional, free text).
  guestName: text("guest_name"),
  // Automatic sessions ("Lad med en gang"): stop once this much energy is in (target % − battery);
  // null = charge until the car stops by itself (no battery reading at all).
  targetKwh: numeric("target_kwh", { precision: 6, scale: 2 }),
  // The car charged (design 6c); null for guest windows -- a guest's car never counts for ours.
  carId: uuid("car_id").references(() => cars.id),
  startedByUserId: uuid("started_by_user_id").references(() => users.id),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  zaptecSessionId: text("zaptec_session_id"),
  startEnergyKwh: numeric("start_energy_kwh", { precision: 6, scale: 2 }),
  lastObservedEnergyKwh: numeric("last_observed_energy_kwh", { precision: 6, scale: 2 }),
  // D68 (Forvarm rows): since when the car hasn't drawn power (null while it
  // does) and when the "på batteriet" push went out (once per Forvarm).
  powerLostAt: timestamp("power_lost_at", { withTimezone: true }),
  powerLostNotifiedAt: timestamp("power_lost_notified_at", { withTimezone: true }),
  energyKwh: numeric("energy_kwh", { precision: 6, scale: 2 }),
}, (t) => [
  // D66: at most one open Lad nå / Forvarm / automatic row per charger, so two
  // taps at the same moment (two phones) can't both insert -- openSession
  // treats the second insert's conflict as "already open". Guest windows
  // live alongside (UC15).
  uniqueIndex("manual_charge_sessions_one_open")
    .on(t.chargerId)
    .where(sql`${t.endedAt} is null and ${t.kind} <> 'guest'`),
]);

// One row per subscribed browser/device. Existence of a row *is* "this user
// is subscribed" -- there's no separate enabled flag, matching the Push
// API's own subscribe/unsubscribe lifecycle. Default is nobody has a row.
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One row per genuinely new OEM reading from the Smartcar webhook (not one
// row per delivery -- see the dedup logic in
// src/app/api/webhooks/smartcar/route.ts). Each row is a complete combined
// snapshot: whichever signal didn't change in a given delivery carries
// forward its previous value, so charting never has to merge two separate
// series. Expected to stay small -- OEM updates have been observed on the
// order of hours, not minutes.
export const vehicleTelemetry = pgTable("vehicle_telemetry", {
  id: uuid("id").primaryKey().defaultRandom(),
  batteryPercent: integer("battery_percent"),
  batteryReportedAt: timestamp("battery_reported_at", { withTimezone: true }),
  odometerKm: numeric("odometer_km", { precision: 8, scale: 1 }),
  odometerReportedAt: timestamp("odometer_reported_at", { withTimezone: true }),
  // Which car reported (Smartcar vehicle id -> cars.smartcar_vehicle_id), design 6c.
  carId: uuid("car_id").references(() => cars.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Redesign data model (design/redesign/HANDOFF.md §7) -------------------
// Prepared for several locations, chargers and cars; the UI shows none of it
// while there is one of each (the address is just the title on Hjem).

export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Editable display name ("Konvallveien 1"); defaults to the Zaptec installation name.
  name: text("name").notNull(),
  zaptecInstallationId: text("zaptec_installation_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Zaptec charger id -> location, plus an optional friendly name.
export const chargers = pgTable("chargers", {
  id: text("id").primaryKey(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const cars = pgTable("cars", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  batteryCapacityKwh: numeric("battery_capacity_kwh", { precision: 5, scale: 1 }).notNull(),
  smartcarVehicleId: text("smartcar_vehicle_id"),
  defaultLocationId: uuid("default_location_id").references(() => locations.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Household-wide settings, one row ("singleton"). Read through
// src/lib/settings.ts, which falls back to the defaults below when the row
// doesn't exist yet.
export const settings = pgTable("settings", {
  id: text("id").primaryKey(),
  // UC14: off = the tick stops unplanned sessions (today's behaviour).
  // What happens on plug-in with no plan/session (UC14 + UC16): 'wait' | 'now' | 'smart'.
  onPluginMode: text("on_plugin_mode").notNull().default("wait"),
  // When 'now'/'smart' falls back to 'wait'; null = until someone changes it.
  onPluginModeUntil: timestamp("on_plugin_mode_until", { withTimezone: true }),
  smartTargetPercent: integer("smart_target_percent").notNull().default(80),
  smartReadyByWeekday: text("smart_ready_by_weekday").notNull().default("07:30"),
  smartReadyByWeekend: text("smart_ready_by_weekend").notNull().default("10:00"),
  energyPriceModel: text("energy_price_model").notNull().default("norgespris"),
  // kr/kWh incl. VAT used for cost figures (Norgespris 2026: 0,50).
  energyPriceNokPerKwh: numeric("energy_price_nok_per_kwh", { precision: 6, scale: 3 }).notNull().default("0.500"),
  // Nettleie energiledd (kr/kWh incl. VAT and fees) from the grid company price list:
  // weekdays 06-22, and nights 22-06 + weekends. Null = not included in costs.
  gridDayNokPerKwh: numeric("grid_day_nok_per_kwh", { precision: 6, scale: 3 }),
  gridNightNokPerKwh: numeric("grid_night_nok_per_kwh", { precision: 6, scale: 3 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
});
