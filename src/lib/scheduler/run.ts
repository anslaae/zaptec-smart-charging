import "server-only";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  chargeSchedules,
  scheduleActions,
  schedulerHeartbeat,
  manualChargeSessions,
  chargerObservedState,
  activityEvents,
} from "@/lib/db/schema";
import { listChargers, getChargerState, sendChargerCommand, isCurrentlyCharging } from "@/lib/zaptec/client";
import { ZaptecCommand, ChargerOperationMode } from "@/lib/zaptec/constants";
import type { ChargerState, ZaptecCharger } from "@/lib/zaptec/types";
import {
  decideNextAction,
  estimateChargingPlan,
  reconcileSessionEnergy,
  START_ATTEMPT_WINDOW_MS,
  START_FAILED_REASON,
  startAttemptsExhausted,
  type SchedulerDecision,
} from "./engine";
import { evaluateScheduleAccuracy } from "./accuracy";
import { getLearnedPowerKw } from "./powerHistory.server";
import { logActivity, ActivityType } from "@/lib/activity/log";
import { sendPushToAllSubscribers } from "@/lib/push/send";
import * as push from "@/lib/push/notifications";
import { getStateOfCharge } from "@/lib/smartcar/client";
import { afterPluginModeChange, effectivePluginMode, getSettings, pricesOf, saveSettings, type HouseholdSettings } from "@/lib/settings";
import { automaticTargetKwh, isSmart, manageSmartRows, smartDecision } from "./smartRun";
import { sessionCost } from "@/lib/pricing";
import { getDefaultCar } from "@/lib/places";
import { closeSession, deliveredKwh, endsOnDisconnect, openSession, trackSession, type SessionRow } from "@/lib/sessions";
import { canSkipDbTouch, type QuietTickMemory } from "./tick-gate";
import { AUTOMATION_PAUSED_REASON } from "./loopGuard";
import { applyPreheatHold, preheatHoldActive } from "./preheatHold";
import { checkHoldPower, checkPreheatSessionPower } from "./preheatPower.server";
import { logChargerStates } from "./stateLog.server";
import { recordCompletedSessions } from "./completedSessions.server";
import { loadLoopGuard, NEW_SESSION_ACTION } from "./loopGuard.server";
import { syncIncidents } from "@/lib/incidents/sync.server";
import { planDeliveredNow } from "./engine";

type Schedule = typeof chargeSchedules.$inferSelect;

// Start commands this plan sent since the car was last plugged in (at most
// START_ATTEMPT_WINDOW_MS back) -- see startAttemptsExhausted.
async function startAttemptsUsedUp(schedule: Schedule, now: Date): Promise<boolean> {
  const windowStart = new Date(now.getTime() - START_ATTEMPT_WINDOW_MS);
  const [attempts, [lastPlug], [lastNewSession]] = await Promise.all([
    db
      .select({ createdAt: scheduleActions.createdAt })
      .from(scheduleActions)
      .where(
        and(
          eq(scheduleActions.scheduleId, schedule.id),
          eq(scheduleActions.action, "resume"),
          gte(scheduleActions.createdAt, windowStart),
        ),
      ),
    db
      .select({ createdAt: activityEvents.createdAt })
      .from(activityEvents)
      .where(and(eq(activityEvents.chargerId, schedule.chargerId), eq(activityEvents.type, ActivityType.PluggedIn)))
      .orderBy(desc(activityEvents.createdAt))
      .limit(1),
    db
      .select({ createdAt: scheduleActions.createdAt })
      .from(scheduleActions)
      .where(and(eq(scheduleActions.scheduleId, schedule.id), eq(scheduleActions.action, NEW_SESSION_ACTION)))
      .orderBy(desc(scheduleActions.createdAt))
      .limit(1),
  ]);
  const plugTimes = [lastPlug?.createdAt, lastNewSession?.createdAt].filter((d): d is Date => d != null);
  return startAttemptsExhausted({
    attemptTimes: attempts.map((a) => a.createdAt),
    lastPluggedInAt: plugTimes.length ? new Date(Math.max(...plugTimes.map((d) => d.getTime()))) : null,
    now,
  });
}

// Status writes in the loop only touch rows that are still open: a plan
// cancelled meanwhile (a person, a mode change, another tick) must not be
// brought back to "active" by this tick's stale copy.
const stillOpen = (id: string) =>
  and(eq(chargeSchedules.id, id), inArray(chargeSchedules.status, ["pending", "active"]));

// Module-level, so it survives across ticks on a warm Vercel instance but
// resets (safely -- see tick-gate.ts) on a cold start. Not shared across
// instances, and doesn't need to be: it only ever permits *skipping* a
// database check, never authorizes anything.
let lastFullTick: QuietTickMemory | null = null;

const notify = (payload: Parameters<typeof sendPushToAllSubscribers>[0]) =>
  sendPushToAllSubscribers(payload).catch(() => undefined);

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
//
// The plug-in push (notifications.nb.json) depends on what's waiting: a
// pending plan gets "starter ca. HH:MM", no plan gets the Planlegg / Lad nå
// prompt, and a guest window or allowed automatic charging gets nothing --
// the household didn't plug that car in.
async function logStateTransitions(
  chargers: ZaptecCharger[],
  stateCache: Map<string, ChargerState>,
  schedules: Schedule[],
  guestChargerIds: Set<string>,
  settings: HouseholdSettings,
  learnedPowerKw: number | null,
  previousByCharger: Map<string, number | null>,
  capacityKwh: number,
): Promise<void> {

  for (const charger of chargers) {
    const state = stateCache.get(charger.id);
    if (!state) continue;

    const prevMode = previousByCharger.get(charger.id);
    const currentMode = state.operationMode;

    if (prevMode === currentMode) continue; // nothing changed -- no write needed, see tick-gate.ts

    if (prevMode !== undefined) {
      if (currentMode === ChargerOperationMode.Disconnected) {
        await logActivity(charger.id, charger.name, ActivityType.Unplugged);
        await logUnpluggedBeforeTarget(charger, state, schedules, capacityKwh);
      } else if (prevMode === ChargerOperationMode.Disconnected) {
        await logActivity(charger.id, charger.name, ActivityType.PluggedIn);
        await notifyPluggedIn(charger, state, schedules, guestChargerIds, settings, learnedPowerKw);
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

// D75: unplugging before a plan reached its target is a choice, not an
// incident -- no warning, no push, but a line in Aktivitet.
async function logUnpluggedBeforeTarget(
  charger: ZaptecCharger,
  state: ChargerState,
  schedules: Schedule[],
  capacityKwh: number,
): Promise<void> {
  const plan = schedules.find((s) => s.chargerId === charger.id && s.startedAt != null && s.startPercent != null);
  if (!plan) return;
  const delivered = planDeliveredNow(
    {
      zaptecSessionId: plan.zaptecSessionId,
      priorSessionEnergyKwh: Number(plan.priorSessionEnergyKwh ?? 0),
      lastObservedSessionEnergyKwh: Number(plan.lastObservedSessionEnergyKwh ?? 0),
    },
    state,
  );
  if (delivered >= Number(plan.targetEnergyKwh)) return;
  const percent = push.reachedPercent({ startPercent: plan.startPercent, targetPercent: plan.targetPercent, deliveredKwh: delivered, capacityKwh });
  await logActivity(charger.id, charger.name, ActivityType.UnpluggedBeforeTarget, { detail: JSON.stringify({ percent }) });
}

async function notifyPluggedIn(
  charger: ZaptecCharger,
  state: ChargerState,
  schedules: Schedule[],
  guestChargerIds: Set<string>,
  settings: HouseholdSettings,
  learnedPowerKw: number | null,
): Promise<void> {
  if (guestChargerIds.has(charger.id)) return;
  const schedule = schedules.find((s) => s.chargerId === charger.id && s.status === "pending" && !isSmart(s));
  if (schedule) {
    const plan = estimateChargingPlan(
      { targetEnergyKwh: Number(schedule.targetEnergyKwh), readyBy: schedule.readyBy },
      state,
      learnedPowerKw,
    );
    const startTime = plan.latestStartTime > new Date() ? plan.latestStartTime : new Date();
    await notify(push.pluggedInPlanWaiting({ scheduleId: schedule.id, startTime }));
    return;
  }
  // An active plan or a Smart lading row (which sends smart_planned) covers it.
  if (schedules.some((s) => s.chargerId === charger.id)) return;
  if (effectivePluginMode(settings) === "now") return; // it just charges; nothing to decide
  const reading = await getStateOfCharge().catch(() => null);
  await notify(
    push.pluggedInNoPlan({
      chargerId: charger.id,
      battery: reading ? { percent: reading.percent, measuredAt: reading.oemUpdatedAt } : null,
    }),
  );
}

// The Zaptec installation's own "Require authentication" switch can't be
// controlled from our side (confirmed against the public API schema -- the
// installation update endpoint only exposes current-limit fields), so with it
// off (free charging, chosen because requiring a physical RFID tap blocks our
// own automation too) *anyone* who plugs in auto-starts a session. This is
// the software-side gate that compensates: any charger drawing power with no
// pending/active schedule and no open session row gets stopped.
// StopChargingFinal latches (sets FinalStopActive), so it won't silently
// resume on its own -- it stays off until someone we recognize starts it
// again. This only runs at the cron cadence (currently every minute), so an
// unrecognized session can draw power for up to that long before it's cut.
//
// Session rows (src/lib/sessions.ts) are the authorisations: Lad nå,
// Forvarm, a guest window (UC15) and -- when "Tillat automatisk lading" is
// on (UC14) -- an automatic row this function opens itself instead of
// stopping the car. Each row's energy is tracked while connected and
// recorded when it closes. A guest window that hasn't seen its car yet
// survives "disconnected"; it starts the car once (free charging may be
// latched off by an earlier enforcement stop) when the guest plugs in.
//
// Returns whether any session row is still open once this tick is done, so
// the caller can fold that into the tick-gate memory -- an open session must
// never be treated as "quiet" (see tick-gate.ts).
async function enforceAuthorizedCharging(
  chargers: ZaptecCharger[],
  scheduledChargerIds: Set<string>,
  stateCache: Map<string, ChargerState>,
  settings: HouseholdSettings,
  previousModes: Map<string, number | null>,
  capacityKwh: number,
  pausedChargerIds: Set<string>,
): Promise<{ anyOpenSessionsRemain: boolean; guestChargerIds: Set<string> }> {
  const now0 = new Date();
  const openSessions = await db
    .select()
    .from(manualChargeSessions)
    .where(isNull(manualChargeSessions.endedAt));
  const stillOpen: SessionRow[] = [];
  let openedAutomatic = false;

  for (const charger of chargers) {
    let state = stateCache.get(charger.id);
    if (!state) {
      state = await getChargerState(charger.id, charger.isOnline, charger.circuitId, charger.installationId);
      stateCache.set(charger.id, state);
    }
    const rows = openSessions.filter((s) => s.chargerId === charger.id);

    // An authorization only covers the connection it was opened for. Close
    // it once the car disconnects so a *different* car plugging in later
    // isn't waved through by a stale row.
    if (state.operationMode === ChargerOperationMode.Disconnected) {
      for (const row of rows) {
        if (!endsOnDisconnect(row)) {
          stillOpen.push(row);
          continue;
        }
        await closeSession(row);
        if (row.kind === "guest") await logActivity(charger.id, charger.name, ActivityType.GuestEnded);
      }
      continue;
    }

    const authorising: SessionRow[] = [];
    for (const row of rows) {
      // Bound to a physical session that's no longer the one plugged in: the
      // unplug fell between two ticks (or that tick failed). It must not
      // authorise the car that's there now.
      if (row.zaptecSessionId != null && state.sessionId != null && row.zaptecSessionId !== state.sessionId) {
        await closeSession(row);
        if (row.kind === "guest") await logActivity(charger.id, charger.name, ActivityType.GuestEnded);
        continue;
      }
      const tracked = await trackSession(row, state);
      // D68: a Forvarm whose car stopped drawing power warms on the battery -- say so (no command).
      if (tracked.kind === "preheat") await checkPreheatSessionPower(tracked, state, now0);
      // "Lad med en gang" stops at its target % (HANDOFF §6b, owner decision D51).
      const target = tracked.kind === "automatic" && tracked.targetKwh != null ? Number(tracked.targetKwh) : null;
      if (target != null && (deliveredKwh(tracked) ?? 0) >= target) {
        await sendChargerCommand(charger.id, ZaptecCommand.StopChargingFinal).catch(() => undefined);
        await closeSession(tracked);
        await logActivity(charger.id, charger.name, ActivityType.AutomaticCompleted);
        continue;
      }
      const guestJustArrived = row.kind === "guest" && row.zaptecSessionId == null && tracked.zaptecSessionId != null;
      if (guestJustArrived && !isCurrentlyCharging(state) && state.finalStopActive) {
        await sendChargerCommand(charger.id, ZaptecCommand.ResumeCharging).catch(() => undefined);
      }
      stillOpen.push(tracked);
      authorising.push(tracked);
    }
    if (authorising.length > 0) continue; // authorized by a session row
    if (scheduledChargerIds.has(charger.id)) continue; // governed by the per-schedule loop below instead

    // UC14 when the charger is still latched off by an earlier stop: start a
    // car that was just plugged in (only on the plug-in itself, so it never
    // restarts a car someone stopped with "Stopp lading").
    const justPluggedIn = previousModes.get(charger.id) === ChargerOperationMode.Disconnected;
    if (effectivePluginMode(settings) === "now" && justPluggedIn && !isCurrentlyCharging(state) && state.finalStopActive) {
      await openSession(charger.id, "automatic", null, state, null, await automaticTargetKwh(state, settings, capacityKwh, now0));
      await sendChargerCommand(charger.id, ZaptecCommand.ResumeCharging).catch(() => undefined);
      openedAutomatic = true;
      continue;
    }

    if (!isCurrentlyCharging(state)) continue;

    if (effectivePluginMode(settings) === "now") {
      await openSession(charger.id, "automatic", null, state, null, await automaticTargetKwh(state, settings, capacityKwh, now0));
      openedAutomatic = true;
      continue;
    }

    // D65: the loop guard holds the app's automated commands back -- this
    // car charges unchecked until it's re-plugged or someone acts.
    if (pausedChargerIds.has(charger.id)) {
      console.error(`[scheduler] charger ${charger.id} (${charger.name}): charging with no plan, not stopped -- automation paused`);
      continue;
    }
    console.error(
      `[scheduler] charger ${charger.id} (${charger.name}) is charging with no schedule or session -- stopping it`,
    );
    await sendChargerCommand(charger.id, ZaptecCommand.StopChargingFinal).catch(() => undefined);
    await logActivity(charger.id, charger.name, ActivityType.StoppedUnplanned);
  }

  return {
    anyOpenSessionsRemain: stillOpen.length > 0 || openedAutomatic,
    guestChargerIds: new Set(stillOpen.filter((s) => s.kind === "guest").map((s) => s.chargerId)),
  };
}

export async function runSchedulerTick(): Promise<{ processed: number; skipped?: boolean }> {
  const now0 = new Date();
  const tickStartedAt = now0.toISOString();

  // Zaptec calls cost nothing in database terms, so they happen before any
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

  // D69: the raw charger state, one row only when something meaningful
  // changed, plus a 30-day prune. A diagnostic: it never fails the tick.
  await logChargerStates(
    chargers.map((c) => stateCache.get(c.id)).filter((s): s is ChargerState => s != null),
    now0,
  ).catch((error) => console.error("[scheduler] charger state log failed:", error));

  // "Når bilen kobles til" with an end time (HANDOFF §3b/§6b): once it has
  // passed, it's back to "wait" -- saved, logged, open automatic sessions
  // closed and smart rows cancelled, so enforcement stops them below. Done
  // before loading the open rows, so a row cancelled here can't be revived.
  let settings = await getSettings();
  if (settings.onPluginMode !== "wait" && effectivePluginMode(settings, now0) === "wait") {
    const previous = settings.onPluginMode;
    settings = await saveSettings({ onPluginMode: "wait", onPluginModeUntil: null }, null);
    await afterPluginModeChange(previous, "wait", null, true);
  }
  const [openRows, learnedPowerKw] = await Promise.all([
    db.select().from(chargeSchedules).where(inArray(chargeSchedules.status, ["pending", "active"])),
    // One query per tick, shared by every schedule below -- see
    // powerHistory.server.ts for why this is preferred over the circuit's
    // theoretical max power.
    getLearnedPowerKw(),
  ]);

  // Smart lading (UC16): plan new plug-ins, drop rows whose car left,
  // re-plan when reality drifts. New rows join this tick's schedules.
  const car = await getDefaultCar(null);
  const capacityKwh = car?.batteryCapacityKwh ?? 46;
  const smart = await manageSmartRows({ chargers, stateCache, schedules: openRows, settings, learnedPowerKw, capacityKwh, now: now0 });
  const schedules = [...openRows.filter((s) => !smart.cancelledIds.has(s.id)), ...smart.created];
  const previousModes = new Map(
    (await db.select().from(chargerObservedState)).map((row) => [row.chargerId, row.operationMode]),
  );

  console.log(
    `[scheduler] tick at ${tickStartedAt}: ${schedules.length} pending/active schedule(s)`,
  );

  // Runs for every charger regardless of whether any schedule exists, since
  // an unauthorized session can happen on a charger with no schedule at all.
  // stateCache is already populated for every charger from the Zaptec calls
  // above, so neither this nor the transition log below needs to re-fetch.
  // D65 loop guard, per charger, before anything sends a command this tick.
  // Trips once per incident: one event and one push, then "paused" until a
  // re-plug or a person acts. Sessions people started are never stopped by
  // it -- it only holds the app's own automated commands back.
  const pausedChargerIds = new Set<string>();
  for (const charger of chargers) {
    const sessionId = stateCache.get(charger.id)?.sessionId ?? null;
    const guard = await loadLoopGuard(charger.id, now0, sessionId);
    if (guard === "ok") continue;
    pausedChargerIds.add(charger.id);
    if (guard === "trip") {
      console.error(`[scheduler] charger ${charger.id} (${charger.name}): on/off too often -- automation paused`);
      // The session id goes in detail: a different one later clears the guard.
      await logActivity(charger.id, charger.name, ActivityType.AutomationPaused, { detail: sessionId ?? undefined });
      // The push goes out with the D75 "locked" incident (syncIncidents, end of tick).
    }
  }

  const { anyOpenSessionsRemain, guestChargerIds } = await enforceAuthorizedCharging(
    chargers,
    new Set(schedules.map((s) => s.chargerId)),
    stateCache,
    settings,
    previousModes,
    capacityKwh,
    pausedChargerIds,
  );
  await logStateTransitions(chargers, stateCache, schedules, guestChargerIds, settings, learnedPowerKw, previousModes, capacityKwh);

  // D72: a session Zaptec has closed (CompletedSession): store its exact
  // energy and hourly meter readings, and correct the rows that ran to its
  // end. After enforcement, so rows closed on this tick's unplug count.
  // Bookkeeping only: it never fails the tick.
  await recordCompletedSessions(
    chargers.map((c) => stateCache.get(c.id)).filter((s): s is ChargerState => s != null),
  ).catch((error) => console.error("[scheduler] recording completed sessions failed:", error));

  // Written only after enforcement succeeded: a tick that throws before
  // here (e.g. code deployed before its migration) leaves the heartbeat
  // stale, so the dashboard shows the problem instead of a green badge.
  // Recorded whenever a full tick runs, even with zero
  // schedules, so the dashboard can tell whether the external cron
  // (cron-job.org) is actually still calling this at all -- not just whether
  // a given schedule has been evaluated. While nothing's happening this only
  // runs once per FULL_TICK_INTERVAL_MS (see tick-gate.ts), not every tick.
  await db
    .insert(schedulerHeartbeat)
    .values({ id: "singleton", lastTickAt: now0 })
    .onConflictDoUpdate({ target: schedulerHeartbeat.id, set: { lastTickAt: now0 } });

  const allDisconnected = modes.every((mode) => mode === ChargerOperationMode.Disconnected);
  lastFullTick = {
    checkedAt: now0,
    allQuiet: allDisconnected && schedules.length === 0 && !anyOpenSessionsRemain,
  };

  for (const schedule of schedules) {
    // UC15: while the charger is lent out, plans wait (the guest's car is
    // plugged in, not ours). They pick up again after the guest unplugs.
    if (guestChargerIds.has(schedule.chargerId)) continue;

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
          state.lastCompletedSession,
        );
        effectiveState = { ...state, sessionEnergyKwh: effectiveSessionEnergyKwh };
        sessionEnergyUpdate = {
          zaptecSessionId: nextTracker.zaptecSessionId,
          priorSessionEnergyKwh: nextTracker.priorSessionEnergyKwh.toString(),
          lastObservedSessionEnergyKwh: nextTracker.lastObservedSessionEnergyKwh.toString(),
        };
      }

      if (schedule.zaptecSessionId != null && state.sessionId != null && state.sessionId !== schedule.zaptecSessionId) {
        await db
          .insert(scheduleActions)
          .values({ scheduleId: schedule.id, chargerId: schedule.chargerId, action: NEW_SESSION_ACTION, commandId: 0 });
      }

      const targetKwh = Number(schedule.targetEnergyKwh);
      let decision: SchedulerDecision = isSmart(schedule)
        ? smartDecision(schedule, effectiveState, now)
        : decideNextAction(
            { targetEnergyKwh: targetKwh, readyBy: schedule.readyBy, started: schedule.startedAt != null },
            effectiveState,
            now,
            learnedPowerKw,
          );

      // D67: Forvarm's hold keeps the power on -- no pause, no stop at the
      // target -- until it ends; then the plan decides as usual. A hold that
      // ended (time, unplug, new session) is cleared from the row.
      const holdActive = preheatHoldActive({
        holdUntil: schedule.preheatHoldUntil,
        scheduleSessionId: schedule.zaptecSessionId,
        state,
        now,
      });
      if (schedule.preheatHoldUntil != null && !holdActive) {
        await db
          .update(chargeSchedules)
          .set({ preheatHoldUntil: null, preheatPowerLostAt: null, preheatPowerLostNotifiedAt: null })
          .where(eq(chargeSchedules.id, schedule.id));
      }
      // D68: under the hold, the car may still stop drawing by itself.
      if (holdActive) await checkHoldPower(schedule, state, now);
      decision = applyPreheatHold(decision, holdActive);

      // D65: the loop guard holds start/pause back (a final stop at the target
      // still goes out: it ends the plan, it can't start a loop).
      if ((decision.action === "resume" || decision.action === "pause") && pausedChargerIds.has(schedule.chargerId)) {
        decision = { action: "none", reason: AUTOMATION_PAUSED_REASON, isProblem: true };
      }

      // D64: a few unanswered start commands since the plug-in, and the plan
      // stops trying (and says so once) instead of sending one every minute.
      if (decision.action === "resume" && (await startAttemptsUsedUp(schedule, now))) {
        // Said once, by the D75 "start_failed" incident (syncIncidents, end of tick).
        decision = { action: "none", reason: START_FAILED_REASON, isProblem: true };
      }

      const decisionDetail = decision.action === "none" ? ` — ${decision.reason}` : "";
      console.log(
        `[scheduler] schedule ${schedule.id} (charger ${schedule.chargerId}): ${decision.action}${decisionDetail}`,
      );

      if (decision.action === "complete") {
        await applyCommand(schedule, "complete", ZaptecCommand.StopChargingFinal).catch(
          () => undefined,
        );
        const delivered = effectiveState.sessionEnergyKwh ?? 0;
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
            targetEnergyKwh: targetKwh,
            deliveredEnergyKwh: delivered,
            wasPaused: resumeActions.length > 1,
          }).summary;
        }
        await logActivity(schedule.chargerId, schedule.chargerName, ActivityType.PlanCompleted, {
          detail: accuracyDetail,
        });
        await notify(
          push.planCompleted({
            scheduleId: schedule.id,
            targetPercent: push.reachedPercent({
              startPercent: schedule.startPercent,
              targetPercent: schedule.targetPercent,
              deliveredKwh: delivered,
              capacityKwh,
            }),
            deliveredKwh: delivered,
            costNok: sessionCost(delivered, schedule.startedAt ?? now, now, pricesOf(settings)).totalNok,
          }),
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
            ...sessionEnergyUpdate,
          })
          .where(stillOpen(schedule.id));
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
        // Predicted duration (and the remainingKwh it was based on -- stored
        // so it can later be compared against the real duration to refine
        // learnedPowerKw, see powerHistory.ts), captured once at the moment
        // charging actually starts. Recomputed here rather than reusing
        // decideNextAction's internal estimate, since that one doesn't
        // surface remainingKwh/powerKw.
        const firstResumeEstimate = isFirstResume
          ? estimateChargingPlan({ targetEnergyKwh: targetKwh, readyBy: schedule.readyBy }, effectiveState, learnedPowerKw)
          : null;
        if (isFirstResume) {
          await logActivity(schedule.chargerId, schedule.chargerName, ActivityType.PlanChargingStarted);
          // Smart lading already told everyone its window (smart_planned).
          if (firstResumeEstimate && !isSmart(schedule)) {
            await notify(
              push.planStarted({
                scheduleId: schedule.id,
                targetPercent: schedule.targetPercent,
                targetKwh,
                finishTime: new Date(
                  now.getTime() + (firstResumeEstimate.remainingKwh / firstResumeEstimate.powerKw) * 3_600_000,
                ),
              }),
            );
          }
        }
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
                estimatedDurationMinutes: Math.round(
                  (firstResumeEstimate.remainingKwh / firstResumeEstimate.powerKw) * 60,
                ),
                remainingKwhAtStart: firstResumeEstimate.remainingKwh.toString(),
                // Baseline for reconcileSessionEnergy -- unless the plan
                // was made mid-session and already carries one (see
                // createSchedule), nothing from a prior session yet, and
                // this is the first reading of the one we're now tracking.
                ...(sessionEnergyUpdate ?? {
                  zaptecSessionId: state.sessionId,
                  priorSessionEnergyKwh: "0",
                  lastObservedSessionEnergyKwh: (state.sessionEnergyKwh ?? 0).toString(),
                }),
              }),
            ...(!isFirstResume && sessionEnergyUpdate),
          })
          .where(stillOpen(schedule.id));
        continue;
      }

      // Once-per-plan warnings (notifications.nb.json, "proposed" events):
      // the car isn't plugged in 30 min before the latest start, or the
      // plan is charging but won't make readyBy at the current rate.
      // Sent only after the flag is saved below, so a failing update can't
      // turn a once-per-plan push into one per tick.
      const flags: Partial<Pick<Schedule, "waitingNotifiedAt" | "lateNotifiedAt">> = {};
      const warnings: Parameters<typeof notify>[0][] = [];
      const estimate = estimateChargingPlan(
        { targetEnergyKwh: targetKwh, readyBy: schedule.readyBy },
        effectiveState,
        learnedPowerKw,
      );
      if (
        schedule.status === "pending" &&
        push.shouldRemindWaitingForCar({
          now,
          latestStart: estimate.latestStartTime,
          connected: state.operationMode !== ChargerOperationMode.Disconnected,
          alreadyNotified: schedule.waitingNotifiedAt != null,
        })
      ) {
        warnings.push(
          push.planWaitingForCar({
            scheduleId: schedule.id,
            latestStart: estimate.latestStartTime > now ? estimate.latestStartTime : now,
            readyBy: schedule.readyBy,
            now,
          }),
        );
        flags.waitingNotifiedAt = now;
      }
      if (schedule.lateNotifiedAt == null && isCurrentlyCharging(state) && now < schedule.readyBy) {
        const late = push.lateEstimate({
          now,
          readyBy: schedule.readyBy,
          remainingKwh: estimate.remainingKwh,
          powerKw: estimate.powerKw,
          deliveredKwh: effectiveState.sessionEnergyKwh ?? 0,
          startPercent: schedule.startPercent,
          capacityKwh,
        });
        if (late.late) {
          warnings.push(
            push.planLate({
              scheduleId: schedule.id,
              readyBy: schedule.readyBy,
              now,
              expectedPercent: late.expectedPercent,
              targetPercent: schedule.targetPercent,
            }),
          );
          flags.lateNotifiedAt = now;
        }
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
          ...flags,
        })
        .where(stillOpen(schedule.id));
      for (const warning of warnings) await notify(warning);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[scheduler] schedule ${schedule.id} (charger ${schedule.chargerId}) failed: ${message}`);
      await db
        .update(chargeSchedules)
        .set({ lastError: message, lastEvaluatedAt: now, updatedAt: now })
        .where(stillOpen(schedule.id));
    }
  }

  // D75: after every command this tick sent, so the incidents see the plans' latest state.
  await syncIncidents({ chargers, stateCache, pausedChargerIds, capacityKwh, now: new Date() }).catch((error) =>
    console.error("[scheduler] incidents failed:", error),
  );

  console.log(`[scheduler] tick done: processed ${schedules.length} schedule(s)`);
  return { processed: schedules.length };
}
