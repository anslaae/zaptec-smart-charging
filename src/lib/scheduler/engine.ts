import type { ChargerState } from "@/lib/zaptec/types";
import { isCurrentlyCharging, isPausedAndResumable } from "@/lib/zaptec/state";

export interface ScheduleInput {
  targetEnergyKwh: number;
  readyBy: Date;
}

export type SchedulerDecision =
  | { action: "complete" }
  | { action: "resume" }
  | { action: "pause" }
  | { action: "none"; reason: string };

/**
 * Last-resort fallback charge rate, used only if we have neither a live
 * power reading nor the charger/circuit's real max power (e.g. the circuit
 * lookup failed). Normally state.maxPowerKw — derived from the actual
 * charger + circuit current limits — is used instead of this guess.
 */
const DEFAULT_ASSUMED_POWER_KW = 7.0;

/** Extra time budgeted on top of the raw estimate, to absorb plug-in delays and power dips. */
const SAFETY_MARGIN_MINUTES = 15;

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

  const remainingKwh = schedule.targetEnergyKwh - sessionEnergyKwh;
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

  const mustBeChargingNow = now >= latestStartTime || now >= schedule.readyBy;

  if (mustBeChargingNow) {
    if (isCurrentlyCharging(state)) {
      return { action: "none", reason: "Already charging" };
    }
    if (isPausedAndResumable(state)) {
      return { action: "resume" };
    }
    return {
      action: "none",
      reason: "Needs to charge but charger is not in a resumable state (plug in car?)",
    };
  }

  if (isCurrentlyCharging(state)) {
    return { action: "pause" };
  }

  return { action: "none", reason: "Waiting for the optimal start time" };
}
