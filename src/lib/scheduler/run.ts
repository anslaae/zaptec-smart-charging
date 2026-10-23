import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  chargeSchedules,
  scheduleActions,
  schedulerHeartbeat,
  manualChargeSessions,
  chargerObservedState,
} from "@/lib/db/schema";
import { listChargers, getChargerState, sendChargerCommand, isCurrentlyCharging } from "@/lib/zaptec/client";
import { ZaptecCommand, ChargerOperationMode } from "@/lib/zaptec/constants";
import type { ChargerState, ZaptecCharger } from "@/lib/zaptec/types";
import { decideNextAction, estimateChargingPlan, reconcileSessionEnergy } from "./engine";
import { evaluateScheduleAccuracy } from "./accuracy";
import { getLearnedPowerKw } from "./powerHistory.server";
import { logActivity, ActivityType } from "@/lib/activity/log";
import { sendPushToAllSubscribers } from "@/lib/push/send";
import { canSkipDbTouch, type QuietTickMemory } from "./tick-gate";

// Module-level, so it survives across ticks on a warm Vercel instance but
// resets (safely -- see tick-gate.ts) on a cold start. Not shared across
// instances, and doesn't need to be: it only ever permits *skipping* a
// database check, never authorizes anything.
let lastFullTick: QuietTickMemory | null = null;

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

// Logs plugged-in/unplugged/charging-started/charging-stopped transitions to
// the activity feed by diffing against the last operationMode seen. Only
// logs on an actual change (and never on the very first observation of a
// charger, to avoid a spurious entry every time this table is empty) --
// deliberately limited to these four transitions rather than every mode
// change, so routine idle/paused flapping doesn't turn the activity log into
// noise. This runs for every charger regardless of schedules, since it's
// about physical reality, not app intent. Also skips the chargerObservedState
// write entirely when the mode hasn't changed -- the stored row is already
// correct, and most ticks find nothing new (see tick-gate.ts).
async function logStateTransitions(
  chargers: ZaptecCharger[],
  stateCache: Map<string, ChargerState>,
): Promise<void> {
  const previous = await db.select().from(chargerObservedState);
  const previousByCharger = new Map(previous.map((row) => [row.chargerId, row.operationMode]));

  for (const charger of chargers) {
    const state = stateCache.get(charger.id);
    if (!state) continue;

    const prevMode = previousByCharger.get(charger.id);
    const currentMode = state.operationMode;

    if (prevMode === currentMode) continue; // nothing changed -- no write needed, see tick-gate.ts

    if (prevMode !== undefined) {
      if (currentMode === ChargerOperationMode.Disconnected) {
        await logActivity(charger.id, charger.name, ActivityType.Unplugged);
      } else if (prevMode === ChargerOperationMode.Disconnected) {
        await logActivity(charger.id, charger.name, ActivityType.PluggedIn);
        await sendPushToAllSubscribers({
          title: "Car connected",
          body: `${charger.name} is plugged in.`,
        }).catch(() => undefined);
      } else if (currentMode === ChargerOperationMode.Charging) {
        await logActivity(charger.id, charger.name, ActivityType.ChargingStarted);
      } else if (prevMode === ChargerOperationMode.Charging) {
        await logActivity(charger.id, charger.name, ActivityType.ChargingStopped);
      }
    }

    await db
      .insert(chargerObservedState)
      .values({ chargerId: charger.id, operationMode: currentMode })
      .onConflictDoUpdate({
        target: chargerObservedState.chargerId,
        set: { operationMode: currentMode, updatedAt: new Date() },
      });
  }
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
// again. This only runs at the cron cadence (currently every minute), so an
// unrecognized session can draw power for up to that long before it's cut.
// Returns whether any manual-charge-session row is still open once this tick
// is done, so the caller can fold that into the tick-gate memory -- an open
// session must never be treated as "quiet" (see tick-gate.ts), since it's
// exactly the thing that needs a real check on the next tick (closing it
// once the car disconnects).
async function enforceAuthorizedCharging(
  chargers: ZaptecCharger[],
  scheduledChargerIds: Set<string>,
  stateCache: Map<string, ChargerState>,
): Promise<{ anyOpenSessionsRemain: boolean }> {
  const openSessions = await db
    .select()
    .from(manualChargeSessions)
    .where(isNull(manualChargeSessions.endedAt));
  const openChargerIds = new Set(openSessions.map((s) => s.chargerId));

  for (const charger of chargers) {
    let state = stateCache.get(charger.id);
    if (!state) {
      state = await getChargerState(charger.id, charger.isOnline, charger.circuitId, charger.installationId);
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
      openChargerIds.delete(charger.id);
      continue;
    }

    if (!isCurrentlyCharging(state)) continue;
    if (scheduledChargerIds.has(charger.id)) continue; // governed by the per-schedule loop below instead
    if (openChargerIds.has(charger.id)) continue; // authorized by a manual start

    console.error(
      `[scheduler] charger ${charger.id} (${charger.name}) is charging with no schedule or manual authorization -- stopping it`,
    );
    await sendChargerCommand(charger.id, ZaptecCommand.StopChargingFinal).catch(() => undefined);
    await logActivity(charger.id, charger.name, ActivityType.StoppedUnplanned);
  }

  return { anyOpenSessionsRemain: openChargerIds.size > 0 };
}

export async function runSchedulerTick(): Promise<{ processed: number; skipped?: boolean }> {
  const now0 = new Date();
  const tickStartedAt = now0.toISOString();

  // Zaptec calls cost nothing in Neon terms, so they happen before any
  // database access -- that's what lets the gate below decide whether this
  // tick needs the database at all without touching it first.
  const chargers = await listChargers();
  const chargerById = new Map(chargers.map((charger) => [charger.id, charger]));
  const stateCache = new Map<string, ChargerState>();
  for (const charger of chargers) {
    stateCache.set(
      charger.id,
      await getChargerState(charger.id, charger.isOnline, charger.circuitId, charger.installationId),
    );
  }
  const modes = chargers.map((charger) => stateCache.get(charger.id)?.operationMode ?? null);

  if (canSkipDbTouch(modes, now0, lastFullTick)) {
    return { processed: 0, skipped: true };
  }

  // Recorded unconditionally whenever a full tick runs, even with zero
  // schedules, so the dashboard can tell whether the external cron
  // (cron-job.org) is actually still calling this at all -- not just whether
  // a given schedule has been evaluated. While nothing's happening this only
  // runs once per FULL_TICK_INTERVAL_MS (see tick-gate.ts), not every tick.
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

  // Runs for every charger regardless of whether any schedule exists, since
  // an unauthorized session can happen on a charger with no schedule at all.
  // stateCache is already populated for every charger from the Zaptec calls
  // above, so neither this nor the transition log below needs to re-fetch.
  const { anyOpenSessionsRemain } = await enforceAuthorizedCharging(
    chargers,
    new Set(schedules.map((s) => s.chargerId)),
    stateCache,
  );
  await logStateTransitions(chargers, stateCache);

  const allDisconnected = modes.every((mode) => mode === ChargerOperationMode.Disconnected);
  lastFullTick = {
    checkedAt: now0,
    allQuiet: allDisconnected && schedules.length === 0 && !anyOpenSessionsRemain,
  };

  if (schedules.length === 0) {
    return { processed: 0 };
  }

  // One query per tick, shared by every schedule below -- see
  // powerHistory.server.ts for why this is preferred over the circuit's
  // theoretical max power.
  const learnedPowerKw = await getLearnedPowerKw();

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
          charger?.installationId ?? "",
        );
        stateCache.set(schedule.chargerId, state);
      }

      // A disconnect/reconnect mid-schedule starts a new Zaptec session with
      // its own sessionEnergyKwh counter back at 0 -- reconcile against what
      // prior sessions under this schedule already delivered so the
      // completion check (and the estimate below) sees the true running
      // total, not just the newest session's. Only applies once charging has
      // actually started (zaptecSessionId set); see reconcileSessionEnergy.
      let effectiveState = state;
      let sessionEnergyUpdate: {
        zaptecSessionId: string | null;
        priorSessionEnergyKwh: string;
        lastObservedSessionEnergyKwh: string;
      } | null = null;
      if (schedule.zaptecSessionId != null) {
        const { effectiveSessionEnergyKwh, nextTracker } = reconcileSessionEnergy(
          {
            zaptecSessionId: schedule.zaptecSessionId,
            priorSessionEnergyKwh: Number(schedule.priorSessionEnergyKwh ?? 0),
            lastObservedSessionEnergyKwh: Number(schedule.lastObservedSessionEnergyKwh ?? 0),
          },
          state.sessionId,
          state.sessionEnergyKwh ?? 0,
        );
        effectiveState = { ...state, sessionEnergyKwh: effectiveSessionEnergyKwh };
        sessionEnergyUpdate = {
          zaptecSessionId: nextTracker.zaptecSessionId,
          priorSessionEnergyKwh: nextTracker.priorSessionEnergyKwh.toString(),
          lastObservedSessionEnergyKwh: nextTracker.lastObservedSessionEnergyKwh.toString(),
        };
      }

      const decision = decideNextAction(
        { targetEnergyKwh: Number(schedule.targetEnergyKwh), readyBy: schedule.readyBy },
        effectiveState,
        now,
        learnedPowerKw,
      );

      const decisionDetail = decision.action === "none" ? ` — ${decision.reason}` : "";
      console.log(
        `[scheduler] schedule ${schedule.id} (charger ${schedule.chargerId}): ${decision.action}${decisionDetail}`,
      );

      if (decision.action === "complete") {
        await applyCommand(schedule, "complete", ZaptecCommand.StopChargingFinal).catch(
          () => undefined,
        );
        // A quick "did we estimate this well" check, attached to the
        // activity log entry below -- only possible when startedAt is known
        // (a schedule can in principle reach "complete" without ever having
        // gone through a tracked "resume", e.g. the car was already charging
        // on its own when the schedule was created).
        let accuracyDetail: string | undefined;
        if (schedule.startedAt) {
          const resumeActions = await db
            .select()
            .from(scheduleActions)
            .where(
              and(eq(scheduleActions.scheduleId, schedule.id), eq(scheduleActions.action, "resume")),
            );
          accuracyDetail = evaluateScheduleAccuracy({
            readyBy: schedule.readyBy,
            startedAt: schedule.startedAt,
            finishedAt: now,
            estimatedDurationMinutes: schedule.estimatedDurationMinutes,
            targetEnergyKwh: Number(schedule.targetEnergyKwh),
            deliveredEnergyKwh: effectiveState.sessionEnergyKwh ?? 0,
            wasPaused: resumeActions.length > 1,
          }).summary;
        }
        await logActivity(schedule.chargerId, schedule.chargerName, ActivityType.PlanCompleted, {
          detail: accuracyDetail,
        });
        await sendPushToAllSubscribers({
          title: "Charging stopped",
          body: `Reached ${Number(schedule.targetEnergyKwh).toFixed(1)} kWh on ${schedule.chargerName}.`,
        }).catch(() => undefined);
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
            ...sessionEnergyUpdate,
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
        if (isFirstResume) {
          await logActivity(schedule.chargerId, schedule.chargerName, ActivityType.PlanChargingStarted);
          await sendPushToAllSubscribers({
            title: "Charging started",
            body: `Your planned charge started on ${schedule.chargerName}.`,
          }).catch(() => undefined);
        }
        // Predicted duration (and the remainingKwh it was based on -- stored
        // so it can later be compared against the real duration to refine
        // learnedPowerKw, see powerHistory.ts), captured once at the moment
        // charging actually starts. Recomputed here rather than reusing
        // decideNextAction's internal estimate, since that one doesn't
        // surface remainingKwh/powerKw.
        const firstResumeEstimate = isFirstResume
          ? estimateChargingPlan(
              { targetEnergyKwh: Number(schedule.targetEnergyKwh), readyBy: schedule.readyBy },
              state,
              learnedPowerKw,
            )
          : null;
        await db
          .update(chargeSchedules)
          .set({
            status: "active",
            lastCommand: decision.action,
            lastNote: null,
            lastEvaluatedAt: now,
            lastError: null,
            updatedAt: now,
            ...(isFirstResume &&
              firstResumeEstimate && {
                startedAt: now,
                zaptecSessionId: state.sessionId,
                estimatedDurationMinutes: Math.round(
                  (firstResumeEstimate.remainingKwh / firstResumeEstimate.powerKw) * 60,
                ),
                remainingKwhAtStart: firstResumeEstimate.remainingKwh.toString(),
                // Baseline for reconcileSessionEnergy -- nothing from a prior
                // session yet, and this is the first reading of the one
                // we're now tracking.
                priorSessionEnergyKwh: "0",
                lastObservedSessionEnergyKwh: (state.sessionEnergyKwh ?? 0).toString(),
              }),
            ...(!isFirstResume && sessionEnergyUpdate),
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
          ...sessionEnergyUpdate,
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
