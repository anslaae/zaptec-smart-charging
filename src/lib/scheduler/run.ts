import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  chargeSchedules,
  scheduleActions,
  schedulerHeartbeat,
  manualChargeSessions,
} from "@/lib/db/schema";
import { listChargers, getChargerState, sendChargerCommand, isCurrentlyCharging } from "@/lib/zaptec/client";
import { ZaptecCommand, ChargerOperationMode } from "@/lib/zaptec/constants";
import type { ChargerState, ZaptecCharger } from "@/lib/zaptec/types";
import { decideNextAction } from "./engine";

// Records the decision, so there's an internal log of what the scheduler
// actually sent over time, not just the latest state.
async function applyCommand(
  schedule: { id: string; chargerId: string },
  action: string,
  commandId: number,
): Promise<void> {
  await sendChargerCommand(schedule.chargerId, commandId);

  await db.insert(scheduleActions).values({
    scheduleId: schedule.id,
    chargerId: schedule.chargerId,
    action,
    commandId,
  });
}

// The Zaptec installation's own "Require authentication" switch can't be
// controlled from our side (confirmed against the public API schema -- the
// installation update endpoint only exposes current-limit fields), so with it
// off (free charging, chosen because requiring a physical RFID tap blocks our
// own automation too) *anyone* who plugs in auto-starts a session. This is
// the software-side gate that compensates: any charger drawing power with no
// pending/active schedule and no open manual authorization gets stopped.
// StopChargingFinal latches (sets FinalStopActive), so it won't silently
// resume on its own -- it stays off until someone we recognize starts it
// again. This only runs at the cron cadence (currently every 4 minutes), so
// an unrecognized session can draw power for up to that long before it's cut.
async function enforceAuthorizedCharging(
  chargers: ZaptecCharger[],
  scheduledChargerIds: Set<string>,
  stateCache: Map<string, ChargerState>,
): Promise<void> {
  const openSessions = await db
    .select()
    .from(manualChargeSessions)
    .where(isNull(manualChargeSessions.endedAt));
  const openChargerIds = new Set(openSessions.map((s) => s.chargerId));

  for (const charger of chargers) {
    let state = stateCache.get(charger.id);
    if (!state) {
      state = await getChargerState(charger.id, charger.isOnline, charger.circuitId);
      stateCache.set(charger.id, state);
    }

    // A manual authorization only covers the connection event it was opened
    // for. Close it once the car disconnects so a *different* car plugging in
    // later isn't waved through by a stale row.
    if (state.operationMode === ChargerOperationMode.Disconnected && openChargerIds.has(charger.id)) {
      await db
        .update(manualChargeSessions)
        .set({ endedAt: new Date() })
        .where(and(eq(manualChargeSessions.chargerId, charger.id), isNull(manualChargeSessions.endedAt)));
      continue;
    }

    if (!isCurrentlyCharging(state)) continue;
    if (scheduledChargerIds.has(charger.id)) continue; // governed by the per-schedule loop below instead
    if (openChargerIds.has(charger.id)) continue; // authorized by a manual start

    console.error(
      `[scheduler] charger ${charger.id} (${charger.name}) is charging with no schedule or manual authorization -- stopping it`,
    );
    await sendChargerCommand(charger.id, ZaptecCommand.StopChargingFinal).catch(() => undefined);
    await db
      .update(schedulerHeartbeat)
      .set({ lastBlockedAt: new Date(), lastBlockedChargerName: charger.name })
      .where(eq(schedulerHeartbeat.id, "singleton"));
  }
}

export async function runSchedulerTick(): Promise<{ processed: number }> {
  const now0 = new Date();
  const tickStartedAt = now0.toISOString();

  // Recorded unconditionally, even with zero schedules, so the dashboard can
  // tell whether the external cron (cron-job.org) is actually still calling
  // this at all -- not just whether a given schedule has been evaluated.
  await db
    .insert(schedulerHeartbeat)
    .values({ id: "singleton", lastTickAt: now0 })
    .onConflictDoUpdate({ target: schedulerHeartbeat.id, set: { lastTickAt: now0 } });

  const schedules = await db
    .select()
    .from(chargeSchedules)
    .where(inArray(chargeSchedules.status, ["pending", "active"]));

  console.log(
    `[scheduler] tick at ${tickStartedAt}: ${schedules.length} pending/active schedule(s)`,
  );

  const chargers = await listChargers();
  const chargerById = new Map(chargers.map((charger) => [charger.id, charger]));
  const stateCache = new Map<string, ChargerState>();

  // Runs for every charger regardless of whether any schedule exists, since
  // an unauthorized session can happen on a charger with no schedule at all.
  await enforceAuthorizedCharging(
    chargers,
    new Set(schedules.map((s) => s.chargerId)),
    stateCache,
  );

  if (schedules.length === 0) {
    return { processed: 0 };
  }

  for (const schedule of schedules) {
    const now = new Date();
    try {
      let state = stateCache.get(schedule.chargerId);
      if (!state) {
        const charger = chargerById.get(schedule.chargerId);
        state = await getChargerState(
          schedule.chargerId,
          charger?.isOnline ?? false,
          charger?.circuitId ?? "",
        );
        stateCache.set(schedule.chargerId, state);
      }

      const decision = decideNextAction(
        { targetEnergyKwh: Number(schedule.targetEnergyKwh), readyBy: schedule.readyBy },
        state,
        now,
      );

      const decisionDetail = decision.action === "none" ? ` — ${decision.reason}` : "";
      console.log(
        `[scheduler] schedule ${schedule.id} (charger ${schedule.chargerId}): ${decision.action}${decisionDetail}`,
      );

      if (decision.action === "complete") {
        await applyCommand(schedule, "complete", ZaptecCommand.StopChargingFinal).catch(
          () => undefined,
        );
        await db
          .update(chargeSchedules)
          .set({
            status: "completed",
            lastCommand: "stop",
            lastNote: "Target energy reached",
            lastEvaluatedAt: now,
            lastError: null,
            endedAt: now,
            updatedAt: now,
          })
          .where(eq(chargeSchedules.id, schedule.id));
        continue;
      }

      if (decision.action === "resume" || decision.action === "pause") {
        const commandId =
          decision.action === "resume"
            ? ZaptecCommand.ResumeCharging
            : ZaptecCommand.StopChargingFinal;
        await applyCommand(schedule, decision.action, commandId);
        // startedAt marks when charging actually began -- only a "resume"
        // means that; a "pause" means the car started too early and we told
        // it to wait, which is the opposite of started.
        const isFirstResume = decision.action === "resume" && schedule.startedAt == null;
        await db
          .update(chargeSchedules)
          .set({
            status: "active",
            lastCommand: decision.action,
            lastNote: null,
            lastEvaluatedAt: now,
            lastError: null,
            updatedAt: now,
            ...(isFirstResume && {
              startedAt: now,
              zaptecSessionId: state.sessionId,
            }),
          })
          .where(eq(chargeSchedules.id, schedule.id));
        continue;
      }

      // A "none" decision can mean "waiting for the optimal start time" --
      // still genuinely pending, not "active". Only promote to active if
      // the charger is actually, confirmedly charging right now (e.g. it
      // started on its own before the scheduler needed to intervene).
      const shouldMarkActive = schedule.status === "pending" && isCurrentlyCharging(state);
      if (decision.isProblem) {
        console.error(
          `[scheduler] schedule ${schedule.id} (charger ${schedule.chargerId}): ${decision.reason}`,
        );
      }
      await db
        .update(chargeSchedules)
        .set({
          ...(shouldMarkActive ? { status: "active" as const } : {}),
          lastNote: decision.reason,
          lastError: decision.isProblem ? decision.reason : null,
          lastEvaluatedAt: now,
          updatedAt: now,
        })
        .where(eq(chargeSchedules.id, schedule.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[scheduler] schedule ${schedule.id} (charger ${schedule.chargerId}) failed: ${message}`);
      await db
        .update(chargeSchedules)
        .set({ lastError: message, lastEvaluatedAt: now, updatedAt: now })
        .where(eq(chargeSchedules.id, schedule.id));
    }
  }

  console.log(`[scheduler] tick done: processed ${schedules.length} schedule(s)`);
  return { processed: schedules.length };
}
