import type { ChargerState } from "@/lib/zaptec/types";
import { isCurrentlyCharging, isPausedAndResumable } from "@/lib/zaptec/state";
import { ChargerOperationMode } from "@/lib/zaptec/constants";

export interface ScheduleInput {
  targetEnergyKwh: number;
  readyBy: Date;
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
const SAFETY_MARGIN_MINUTES = 15;

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
 */
export function estimateChargingPlan(
  schedule: ScheduleInput,
  state: ChargerState,
): ChargingPlanEstimate {
  const sessionEnergyKwh = state.sessionEnergyKwh ?? 0;
  const remainingKwh = Math.max(0, schedule.targetEnergyKwh - sessionEnergyKwh);
  const observedPowerKw =
    state.instantPowerWatts && state.instantPowerWatts > 0
      ? state.instantPowerWatts / 1000
      : null;
  const powerKw = observedPowerKw ?? state.maxPowerKw ?? DEFAULT_ASSUMED_POWER_KW;
  const estimatedHoursNeeded = remainingKwh / powerKw;

  const latestStartTime = new Date(
    schedule.readyBy.getTime() -
      estimatedHoursNeeded * 60 * 60 * 1000 -
      SAFETY_MARGIN_MINUTES * 60 * 1000,
  );

  return { remainingKwh, powerKw, latestStartTime };
}

export function decideNextAction(
  schedule: ScheduleInput,
  state: ChargerState,
  now: Date,
): SchedulerDecision {
  const sessionEnergyKwh = state.sessionEnergyKwh ?? 0;

  if (sessionEnergyKwh >= schedule.targetEnergyKwh) {
    return { action: "complete" };
  }

  if (!state.isOnline) {
    return { action: "none", reason: "Charger is offline" };
  }

  const { latestStartTime } = estimateChargingPlan(schedule, state);
  const mustBeChargingNow = now >= latestStartTime || now >= schedule.readyBy;

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
