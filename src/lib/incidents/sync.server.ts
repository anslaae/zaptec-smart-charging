import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { chargeIncidents, chargeSchedules, manualChargeSessions, scheduleActions, vehicleTelemetry } from "@/lib/db/schema";
import type { ChargerState, ZaptecCharger } from "@/lib/zaptec/types";
import { logActivity, ActivityType } from "@/lib/activity/log";
import { sendPushToAllSubscribers } from "@/lib/push/send";
import { incidentPush } from "@/lib/push/notifications";
import { closeSession, deliveredKwh, type SessionRow } from "@/lib/sessions";
import { estimateBattery } from "@/lib/ui/battery";
import { warningText } from "@/lib/zaptec/health";
import { START_ATTEMPT_WINDOW_MS, START_FAILED_REASON } from "@/lib/scheduler/engine";
import { formatTime } from "@/lib/datetime";
import { getStateOfCharge } from "@/lib/smartcar/client";
import { newerReading } from "@/lib/smartcar/state";
import { currentIncident, incidentStatus, subjectKey, type IncidentKind, type IncidentStatus, type Wanted } from "./rules";

// D75, the tick's side: keep one charge_incidents row per incident up to
// date, and send its one push (flag saved first, as D65/D68) with one
// activity line. Never sends a charger command; the only thing it changes
// besides its own table is closing a Lad nå session 30 min after a full car
// stopped (HANDOFF §6e, case 1).

type Incident = typeof chargeIncidents.$inferSelect;

/** A subject that already pushed for this kind stays quiet this long (reopened incidents, flicker). */
const REPEAT_QUIET_MS = 12 * 3_600_000;
type Schedule = typeof chargeSchedules.$inferSelect;

export interface IncidentContext {
  wanted: Wanted | null;
  /** The open row behind a "session" subject. */
  row: SessionRow | null;
  batteryPercent: number | null;
  targetPercent: number | null;
}

/** What charging is asked for on this charger: an open Lad nå / automatic row first, else a plan that should be charging. */
export async function loadWanted(
  chargerId: string,
): Promise<{ wanted: Wanted | null; row: SessionRow | null; schedule: Schedule | null }> {
  const [rows, schedules] = await Promise.all([
    db
      .select()
      .from(manualChargeSessions)
      .where(
        and(
          eq(manualChargeSessions.chargerId, chargerId),
          isNull(manualChargeSessions.endedAt),
          inArray(manualChargeSessions.kind, ["manual", "automatic", "guest"]),
        ),
      ),
    db
      .select()
      .from(chargeSchedules)
      .where(and(eq(chargeSchedules.chargerId, chargerId), inArray(chargeSchedules.status, ["pending", "active"]))),
  ]);
  // A guest window: the guest's car, not ours -- nothing is wanted (plans wait, UC15 sends no pushes).
  if (rows.some((r) => r.kind === "guest")) return { wanted: null, row: null, schedule: null };
  const row = rows.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0] ?? null;
  if (row) {
    return {
      row,
      schedule: null,
      wanted: {
        type: "session",
        id: row.id,
        kind: row.kind as "manual" | "automatic",
        requestedAt: row.startedAt,
        deliveredKwh: deliveredKwh(row) ?? 0,
      },
    };
  }
  const schedule =
    schedules.find(
      (s) => (s.status === "active" && s.lastCommand === "resume") || s.lastError === START_FAILED_REASON,
    ) ?? null;
  if (!schedule) return { wanted: null, row: null, schedule: null };
  const [lastStart] = await db
    .select({ at: scheduleActions.createdAt })
    .from(scheduleActions)
    .where(and(eq(scheduleActions.scheduleId, schedule.id), eq(scheduleActions.action, "resume")))
    .orderBy(desc(scheduleActions.createdAt))
    .limit(1);
  return {
    row: null,
    schedule,
    wanted: {
      type: "schedule",
      id: schedule.id,
      requestedAt: lastStart?.at ?? null,
      startFailed: schedule.lastError === START_FAILED_REASON,
    },
  };
}

/**
 * Battery now including this session's energy (charging or not), and the
 * target % that counts as "full": a plan's own target, or for Lad nå the last
 * plan's target only if it ran in this same plug-in (an older one says nothing
 * about now; then only FULL_PERCENT counts).
 */
export async function loadBattery(
  chargerId: string,
  state: ChargerState,
  capacityKwh: number,
  now: Date,
  schedule: Schedule | null = null,
): Promise<{ batteryPercent: number | null; targetPercent: number | null }> {
  // The same reading Hjem uses: the (30-min cached) Smartcar read, or the
  // latest webhook reading when that's newer.
  const [api, [stored], [lastPlan]] = await Promise.all([
    getStateOfCharge().catch(() => null),
    db
      .select({ percent: vehicleTelemetry.batteryPercent, at: vehicleTelemetry.batteryReportedAt })
      .from(vehicleTelemetry)
      .where(and(isNotNull(vehicleTelemetry.batteryPercent), isNotNull(vehicleTelemetry.batteryReportedAt)))
      .orderBy(desc(vehicleTelemetry.batteryReportedAt))
      .limit(1),
    db
      .select({ targetPercent: chargeSchedules.targetPercent, zaptecSessionId: chargeSchedules.zaptecSessionId })
      .from(chargeSchedules)
      .where(and(eq(chargeSchedules.chargerId, chargerId), eq(chargeSchedules.status, "completed")))
      .orderBy(desc(chargeSchedules.endedAt))
      .limit(1),
  ]);
  const reading = newerReading(
    api,
    stored?.percent != null && stored.at ? { percent: stored.percent, oemUpdatedAt: stored.at } : null,
  );
  const battery = estimateBattery({
    reading,
    capacityKwh,
    now,
    // Counts the session's energy since the reading even after the car stopped.
    charging: true,
    sessionEnergyKwh: state.sessionEnergyKwh,
    chargeDurationSeconds: state.chargeDurationSeconds,
    remainingPlanKwh: null,
  });
  const samePlugIn = lastPlan != null && state.sessionId != null && lastPlan.zaptecSessionId === state.sessionId;
  const targetPercent = schedule ? schedule.targetPercent : samePlugIn ? lastPlan.targetPercent : null;
  return { batteryPercent: battery.percent, targetPercent };
}

const notify = (payload: Parameters<typeof sendPushToAllSubscribers>[0]) =>
  sendPushToAllSubscribers(payload).catch(() => undefined);

/** Values for the push and the activity line, saved on the incident when it goes out. */
async function incidentDetail(
  incident: Incident,
  status: IncidentStatus,
  context: IncidentContext,
  state: ChargerState,
  now: Date,
): Promise<Record<string, string | number | null>> {
  switch (incident.kind as IncidentKind) {
    case "car": {
      const kwh = context.wanted?.type === "session" ? context.wanted.deliveredKwh : (state.sessionEnergyKwh ?? 0);
      const minutes = context.wanted?.requestedAt
        ? Math.round((now.getTime() - context.wanted.requestedAt.getTime()) / 60_000)
        : 0;
      return { carCase: status.carCase, percent: context.batteryPercent, kwh, minutes };
    }
    case "start_failed": {
      const attempts =
        context.wanted?.type === "schedule"
          ? await db
              .select({ at: scheduleActions.createdAt })
              .from(scheduleActions)
              .where(
                and(
                  eq(scheduleActions.scheduleId, context.wanted.id),
                  eq(scheduleActions.action, "resume"),
                  gte(scheduleActions.createdAt, new Date(now.getTime() - START_ATTEMPT_WINDOW_MS)),
                ),
              )
              .orderBy(scheduleActions.createdAt)
          : [];
      return {
        count: attempts.length,
        from: attempts[0] ? formatTime(attempts[0].at) : null,
        to: attempts.length ? formatTime(attempts[attempts.length - 1].at) : null,
      };
    }
    case "charger_warning":
    case "locked":
      return { warning: warningText(state.health?.warnings) };
    case "offline":
      return {};
  }
}

/** Sends the incident's push and writes its activity line (the flag is already saved). */
async function announce(
  incident: Incident,
  detail: Record<string, string | number | null>,
  chargerName: string,
  guardPaused: boolean,
): Promise<void> {
  const id = incident.id;
  const percent = typeof detail.percent === "number" ? detail.percent : null;
  const log = (type: Parameters<typeof logActivity>[2], values?: Record<string, string | number | null>) =>
    logActivity(incident.chargerId, chargerName, type, values ? { detail: JSON.stringify(values) } : undefined);
  switch (incident.kind as IncidentKind) {
    case "car": {
      const carCase = detail.carCase;
      if (carCase === "full") {
        await log(ActivityType.CarStoppedFull);
        await notify(incidentPush({ incidentId: id, kind: "car", carCase: "full", percent, kwh: Number(detail.kwh ?? 0) }));
      } else if (carCase === "never") {
        await log(ActivityType.CarNeverStarted);
        await notify(incidentPush({ incidentId: id, kind: "car", carCase: "never", minutes: Number(detail.minutes ?? 0) }));
      } else if (carCase === "declinedPlan") {
        await log(ActivityType.CarStopped, { percent: percent != null ? Math.round(percent) : null });
        await notify(incidentPush({ incidentId: id, kind: "car", carCase: "declinedPlan", percent }));
      } else {
        await log(ActivityType.CarStopped, { percent: percent != null ? Math.round(percent) : null });
        await notify(incidentPush({ incidentId: id, kind: "car", carCase: "stopped", percent, kwh: Number(detail.kwh ?? 0) }));
      }
      return;
    }
    case "start_failed":
      await log(ActivityType.StartFailed, { count: detail.count });
      await notify(incidentPush({ incidentId: id, kind: "start_failed", time: incident.since }));
      return;
    case "offline":
      await log(ActivityType.ChargerOffline);
      await notify(incidentPush({ incidentId: id, kind: "offline", since: incident.since }));
      return;
    case "locked":
      // The loop guard logs its own automation_paused line; Zaptec's lock gets the warning line.
      if (!guardPaused) await log(ActivityType.ChargerWarning, { warning: detail.warning });
      await notify(incidentPush({ incidentId: id, kind: "locked" }));
      return;
    case "charger_warning":
      await log(ActivityType.ChargerWarning, { warning: detail.warning });
      await notify(incidentPush({ incidentId: id, kind: "charger_warning", warning: String(detail.warning ?? "") }));
      return;
  }
}

async function closeIncident(incident: Incident, now: Date): Promise<void> {
  await db.update(chargeIncidents).set({ closedAt: now }).where(eq(chargeIncidents.id, incident.id));
}

/** One charger: open, update or close its incident, and announce it once. */
export async function syncChargerIncident(input: {
  charger: Pick<ZaptecCharger, "id" | "name">;
  state: ChargerState;
  guardPaused: boolean;
  capacityKwh: number;
  now: Date;
}): Promise<void> {
  const { charger, state, guardPaused, capacityKwh, now } = input;
  const [{ wanted, row, schedule }, [open]] = await Promise.all([
    loadWanted(charger.id),
    db
      .select()
      .from(chargeIncidents)
      .where(and(eq(chargeIncidents.chargerId, charger.id), isNull(chargeIncidents.closedAt)))
      .limit(1),
  ]);
  const kind = currentIncident({ state, wanted, guardPaused });
  const subject = kind === "locked" && guardPaused ? "charger" : subjectKey(wanted);

  let incident: Incident | undefined = open;
  if (incident && (kind !== incident.kind || subject !== incident.subject)) {
    await closeIncident(incident, now);
    // The charger answers again after an offline incident people saw.
    if (incident.kind === "offline" && incident.notifiedAt != null && state.isOnline) {
      await logActivity(charger.id, charger.name, ActivityType.ChargerBack);
    }
    incident = undefined;
  }
  if (!kind) return;
  if (!incident) {
    [incident] = await db
      .insert(chargeIncidents)
      .values({ chargerId: charger.id, kind, subject, since: now })
      .onConflictDoNothing()
      .returning();
    // Another tick opened one meanwhile: it handles it.
    if (!incident) return;
  }

  const battery =
    kind === "car"
      ? await loadBattery(charger.id, state, capacityKwh, now, schedule)
      : { batteryPercent: null, targetPercent: null };
  const context: IncidentContext = { wanted, row, ...battery };
  const status = incidentStatus({ kind, since: incident.since, state, wanted, ...battery, now });

  if (status.pushes && incident.notifiedAt == null) {
    // One push per subject and kind: a car that stops again in the same Lad nå
    // (notifications.nb.json: max one per session), in each Smart block, or a
    // warning that flickers, shows the card again but quietly.
    const [earlier] = await db
      .select({ id: chargeIncidents.id })
      .from(chargeIncidents)
      .where(
        and(
          eq(chargeIncidents.subject, subject),
          eq(chargeIncidents.kind, kind),
          ne(chargeIncidents.id, incident.id),
          isNotNull(chargeIncidents.notifiedAt),
          gte(chargeIncidents.notifiedAt, new Date(now.getTime() - REPEAT_QUIET_MS)),
        ),
      )
      .limit(1);
    const detail = await incidentDetail(incident, status, context, state, now);
    // Claimed atomically: of two overlapping ticks only one sends.
    const [claimed] = await db
      .update(chargeIncidents)
      .set({ notifiedAt: now, detail })
      .where(and(eq(chargeIncidents.id, incident.id), isNull(chargeIncidents.notifiedAt)))
      .returning({ id: chargeIncidents.id });
    if (claimed && !earlier) await announce(incident, detail, charger.name, guardPaused);
  }

  // Case 1: the full car's Lad nå session closes itself, ending when the car stopped.
  if (status.carCase === "full" && status.autoEndAt && status.autoEndAt <= now && row && row.kind === "manual") {
    await closeSession(row, incident.since);
    await closeIncident(incident, now);
  }
}

/** Every charger, after the tick's commands. A failure is logged and never fails the tick. */
export async function syncIncidents(input: {
  chargers: ZaptecCharger[];
  stateCache: Map<string, ChargerState>;
  pausedChargerIds: Set<string>;
  capacityKwh: number;
  now: Date;
}): Promise<void> {
  for (const charger of input.chargers) {
    const state = input.stateCache.get(charger.id);
    if (!state) continue;
    await syncChargerIncident({
      charger,
      state,
      guardPaused: input.pausedChargerIds.has(charger.id),
      capacityKwh: input.capacityKwh,
      now: input.now,
    }).catch((error) => console.error(`[scheduler] incidents for charger ${charger.id} failed:`, error));
  }
}

/** For Hjem: the open incident and what it reads as now (same rules as the tick). */
export async function loadIncidentView(input: {
  chargerId: string;
  state: ChargerState;
  guardPaused: boolean;
  capacityKwh: number;
  now: Date;
}): Promise<{ incident: Incident; status: IncidentStatus; context: IncidentContext } | null> {
  const { chargerId, state, guardPaused, capacityKwh, now } = input;
  const [open] = await db
    .select()
    .from(chargeIncidents)
    .where(and(eq(chargeIncidents.chargerId, chargerId), isNull(chargeIncidents.closedAt)))
    .limit(1);
  if (!open) return null;
  const { wanted, row, schedule } = await loadWanted(chargerId);
  // The incident the tick saw may have ended since (the car draws again, Stopp): not shown.
  const kind = currentIncident({ state, wanted, guardPaused });
  const subject = kind === "locked" && guardPaused ? "charger" : subjectKey(wanted);
  if (kind !== open.kind || subject !== open.subject) return null;
  const battery =
    kind === "car"
      ? await loadBattery(chargerId, state, capacityKwh, now, schedule)
      : { batteryPercent: null, targetPercent: null };
  const status = incidentStatus({ kind, since: open.since, state, wanted, ...battery, now });
  return { incident: open, status, context: { wanted, row, ...battery } };
}
