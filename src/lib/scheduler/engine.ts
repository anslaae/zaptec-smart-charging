import type { ChargerState } from "@/lib/zaptec/types";
import { isCurrentlyCharging, isPausedAndResumable } from "@/lib/zaptec/state";
import { ChargerOperationMode } from "@/lib/zaptec/constants";

export interface ScheduleInput {
  targetEnergyKwh: number;
  readyBy: Date;
  /**
   * The plan has already started charging (startedAt set). From then on it
   * keeps charging until the target or ready-by: never paused again because
   * the estimate moved. The estimate uses the live power while charging and
   * the learned power while not, so a plan starting right at the edge flipped
   * between "too early" and "must start" every minute (13 Nov 2026: about 20
   * stop/start cycles in 40 min, then Zaptec refused until the car was
   * reconnected). See DECISIONS D64.
   */
  started?: boolean;
}

/** Start commands that can go unanswered before the plan stops trying (D64). */
export const MAX_START_ATTEMPTS = 3;
/** How far back start attempts count: a plug-in, or this long ago, whichever is later. */
export const START_ATTEMPT_WINDOW_MS = 15 * 60_000;
/** Stored as lastError (English, like the other engine reasons); Hjem shows it in Norwegian. */
export const START_FAILED_REASON = "Charger did not start after repeated attempts";

/**
 * Whether to stop sending start commands: this many were already sent since
 * the car was plugged in (or within the window) and it still isn't charging.
 * Keeps a stuck charger -- or any future flip-flop bug -- from turning into a
 * command every minute for hours. Re-plugging the car resets the count.
 */
export function startAttemptsExhausted(input: {
  attemptTimes: Date[];
  lastPluggedInAt: Date | null;
  now: Date;
}): boolean {
  const windowStart = input.now.getTime() - START_ATTEMPT_WINDOW_MS;
  const since = Math.max(windowStart, input.lastPluggedInAt?.getTime() ?? -Infinity);
  return input.attemptTimes.filter((t) => t.getTime() > since).length >= MAX_START_ATTEMPTS;
}

export type SchedulerDecision =
  | { action: "complete" }
  | { action: "resume" }
  | { action: "pause" }
  // isProblem marks a genuine failure to act when charging was needed (vs.
  // a normal, expected wait) -- surfaced as lastError rather than lastNote.
  | { action: "none"; reason: string; isProblem?: boolean };

/**
 * Last-resort fallback charge rate, used only if we have neither a live
 * power reading nor the charger/circuit's real max power (e.g. the circuit
 * lookup failed). Normally state.maxPowerKw — derived from the actual
 * charger + circuit current limits — is used instead of this guess.
 */
const DEFAULT_ASSUMED_POWER_KW = 7.0;

/** Extra time budgeted on top of the raw estimate, to absorb plug-in delays and power dips. */
export const SAFETY_MARGIN_MINUTES = 15;

/** The latest start that still delivers remainingKwh by readyBy at powerKw, incl. the safety margin. */
export function latestStartFor(remainingKwh: number, powerKw: number, readyBy: Date): Date {
  return new Date(readyBy.getTime() - (remainingKwh / powerKw) * 3_600_000 - SAFETY_MARGIN_MINUTES * 60_000);
}

/** The rate a plan is estimated at when nothing is charging: learned, else the circuit max, else a guess. */
export function plannedPowerKw(learnedPowerKw: number | null | undefined, maxPowerKw: number | null | undefined): number {
  return learnedPowerKw ?? maxPowerKw ?? DEFAULT_ASSUMED_POWER_KW;
}

export interface ChargingPlanEstimate {
  remainingKwh: number;
  powerKw: number;
  /** The latest moment charging can start and still hit readyBy, incl. safety margin. */
  latestStartTime: Date;
}

/**
 * The core time-budget math, shared by decideNextAction (to know whether
 * charging must start *now*) and the UI (to show the user when that will
 * be, before it's actually time to start).
 *
 * learnedPowerKw, when available, is the real-world rate this car has
 * actually drawn on past sessions (see powerHistory.ts) -- preferred over
 * state.maxPowerKw, which is only the circuit's theoretical ceiling and was
 * found to overestimate the real charge rate by ~40-65% (the car's onboard
 * charger draws well under what the circuit allows).
 */
export function estimateChargingPlan(
  schedule: ScheduleInput,
  state: ChargerState,
  learnedPowerKw?: number | null,
): ChargingPlanEstimate {
  const sessionEnergyKwh = state.sessionEnergyKwh ?? 0;
  const remainingKwh = Math.max(0, schedule.targetEnergyKwh - sessionEnergyKwh);
  const observedPowerKw =
    state.instantPowerWatts && state.instantPowerWatts > 0
      ? state.instantPowerWatts / 1000
      : null;
  const powerKw =
    observedPowerKw ?? learnedPowerKw ?? state.maxPowerKw ?? DEFAULT_ASSUMED_POWER_KW;
  const latestStartTime = latestStartFor(remainingKwh, powerKw, schedule.readyBy);

  return { remainingKwh, powerKw, latestStartTime };
}

export interface SessionEnergyTracker {
  zaptecSessionId: string | null;
  /** Cumulative kWh from sessions that have already ended under this schedule. */
  priorSessionEnergyKwh: number;
  /** The most recent sessionEnergyKwh reading for whichever session zaptecSessionId currently points at. */
  lastObservedSessionEnergyKwh: number;
}

export interface SessionEnergyReconciliation {
  /** Total delivered across every session seen under this schedule so far -- use this in place of the charger's raw sessionEnergyKwh. */
  effectiveSessionEnergyKwh: number;
  /** What to persist for next tick. */
  nextTracker: SessionEnergyTracker;
}

/**
 * Zaptec's own sessionEnergyKwh resets to 0 whenever the car is unplugged
 * and replugged (a new session starts) -- confirmed by the session ID
 * changing. Without this, a disconnect partway through a schedule would make
 * the completion check think almost nothing had been delivered and
 * re-deliver the full target on top of what the car already got. We don't
 * have the ended session's exact final reading (it may have kept climbing
 * for up to one tick after our last observation of it), so the last value we
 * saw is carried forward -- undercounting by at most one tick's worth of
 * energy, which is a far smaller error than ignoring it entirely.
 */
export function reconcileSessionEnergy(
  tracker: SessionEnergyTracker,
  currentSessionId: string | null,
  currentSessionEnergyKwh: number,
): SessionEnergyReconciliation {
  // No session right now (unplugged, offline, or no reading): nothing new to
  // count. Keep the tracker as it is -- overwriting lastObserved with 0 here
  // would lose the energy of the session that just ended (and break a
  // negative baseline, see createSchedule).
  if (currentSessionId == null) {
    return {
      effectiveSessionEnergyKwh: tracker.priorSessionEnergyKwh + tracker.lastObservedSessionEnergyKwh,
      nextTracker: tracker,
    };
  }

  const sessionChanged = tracker.zaptecSessionId != null && currentSessionId !== tracker.zaptecSessionId;
  // A session's counter only grows; a lower reading for the same session is a
  // glitch (e.g. a null reported as 0), not energy flowing back.
  if (!sessionChanged && tracker.zaptecSessionId != null) {
    currentSessionEnergyKwh = Math.max(currentSessionEnergyKwh, tracker.lastObservedSessionEnergyKwh);
  }

  const priorSessionEnergyKwh = sessionChanged
    ? tracker.priorSessionEnergyKwh + tracker.lastObservedSessionEnergyKwh
    : tracker.priorSessionEnergyKwh;

  return {
    effectiveSessionEnergyKwh: priorSessionEnergyKwh + currentSessionEnergyKwh,
    nextTracker: {
      zaptecSessionId: currentSessionId,
      priorSessionEnergyKwh,
      lastObservedSessionEnergyKwh: currentSessionEnergyKwh,
    },
  };
}

export function decideNextAction(
  schedule: ScheduleInput,
  state: ChargerState,
  now: Date,
  learnedPowerKw?: number | null,
): SchedulerDecision {
  const sessionEnergyKwh = state.sessionEnergyKwh ?? 0;

  if (sessionEnergyKwh >= schedule.targetEnergyKwh) {
    return { action: "complete" };
  }

  if (!state.isOnline) {
    return { action: "none", reason: "Charger is offline" };
  }

  const { latestStartTime } = estimateChargingPlan(schedule, state, learnedPowerKw);
  const mustBeChargingNow = schedule.started === true || now >= latestStartTime || now >= schedule.readyBy;

  if (mustBeChargingNow) {
    if (isCurrentlyCharging(state)) {
      return { action: "none", reason: "Already charging" };
    }
    if (isPausedAndResumable(state)) {
      return { action: "resume" };
    }
    if (state.operationMode === ChargerOperationMode.Disconnected) {
      return {
        action: "none",
        reason: "Needs to charge but no car is connected",
        isProblem: true,
      };
    }
    // Connected but never explicitly stopped by us (e.g. just plugged in,
    // sitting idle). There's no separate "start" command -- ResumeCharging
    // is sent regardless; if there's nothing to resume, Zaptec rejects it
    // with a harmless 528 that sendChargerCommand treats as success.
    return { action: "resume" };
  }

  if (isCurrentlyCharging(state)) {
    return { action: "pause" };
  }

  return { action: "none", reason: "Waiting for the optimal start time" };
}

/**
 * kWh an open plan has delivered right now, for display: the reconciled total
 * when the plan tracks sessions, else the current session's counter. Never
 * negative (a baseline from createSchedule can briefly exceed a fresh
 * session's counter before the tick reconciles a re-plug).
 */
export function planDeliveredNow(
  tracker: { zaptecSessionId: string | null; priorSessionEnergyKwh: number; lastObservedSessionEnergyKwh: number },
  state: Pick<ChargerState, "sessionId" | "sessionEnergyKwh">,
): number {
  const delivered =
    tracker.zaptecSessionId != null
      ? reconcileSessionEnergy(tracker, state.sessionId, state.sessionEnergyKwh ?? 0).effectiveSessionEnergyKwh
      : (state.sessionEnergyKwh ?? 0);
  return Math.max(0, delivered);
}
