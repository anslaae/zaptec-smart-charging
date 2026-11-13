// D67 option A (owner, 2026-11-13): Forvarm while a plan or Smart lading is
// charging puts a time-limited hold on the power. Until it ends -- the
// earlier of 60 min from the tap and the plan's readyBy -- the tick turns the
// plan's pause/complete into "none", so the car keeps drawing power for the
// cabin heater. Afterwards the plan carries on as before (it isn't cancelled
// or replaced). The hold sends no command of its own, so the loop guard (D65)
// and the start cap (D64) never see it. Pure, unit tested.

import type { ChargerState } from "@/lib/zaptec/types";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import { sessionCost, type Prices } from "@/lib/pricing";
import type { SchedulerDecision } from "./engine";

export const PREHEAT_HOLD_MS = 60 * 60_000;
export const PREHEAT_HOLD_REASON = "Preheat hold: keeping the power on";

/** When a hold set now ends: 60 min, or readyBy if that's sooner. Null when readyBy has passed. */
export function preheatHoldEnd(now: Date, readyBy: Date): Date | null {
  const end = Math.min(now.getTime() + PREHEAT_HOLD_MS, readyBy.getTime());
  return end > now.getTime() ? new Date(end) : null;
}

/**
 * Whether a stored hold still counts: not expired, the car still connected,
 * and still the plug-in it was set for (the plan's Zaptec session, when it
 * has one). Unplug, a re-plug or a new session ends it even if the tick
 * hasn't cleared the column yet.
 */
export function preheatHoldActive(input: {
  holdUntil: Date | null;
  scheduleSessionId: string | null;
  state: Pick<ChargerState, "operationMode" | "sessionId">;
  now: Date;
}): boolean {
  const { holdUntil, scheduleSessionId, state, now } = input;
  if (holdUntil == null || holdUntil.getTime() <= now.getTime()) return false;
  if (state.operationMode === ChargerOperationMode.Disconnected) return false;
  if (scheduleSessionId != null && state.sessionId != null && scheduleSessionId !== state.sessionId) return false;
  return true;
}

/** During a hold the plan neither pauses nor completes (stops); everything else is unchanged. */
export function applyPreheatHold(decision: SchedulerDecision, holdActive: boolean): SchedulerDecision {
  if (!holdActive) return decision;
  if (decision.action === "pause" || decision.action === "complete") {
    return { action: "none", reason: PREHEAT_HOLD_REASON };
  }
  return decision;
}

/**
 * What the hold may add, for the sheet's "ca. 3 kWh / 4 kr ekstra": today's
 * charge power x the hold's length, capped by the room left in the battery
 * (the car stops by itself when full), priced for those hours. nok is null
 * when no energy price is set.
 */
export function preheatHoldEstimate(input: {
  now: Date;
  until: Date;
  powerKw: number | null;
  prices: Prices | null;
  /** kWh until the battery is full, when the battery % is known. */
  roomKwh: number | null;
}): { kwh: number; nok: number | null } {
  const hours = Math.max(0, input.until.getTime() - input.now.getTime()) / 3_600_000;
  let kwh = Math.max(0, input.powerKw ?? 0) * hours;
  if (input.roomKwh != null) kwh = Math.min(kwh, Math.max(0, input.roomKwh));
  kwh = Math.round(kwh * 10) / 10;
  const priced = input.prices != null && input.prices.energyNokPerKwh > 0;
  const nok = priced ? sessionCost(kwh, input.now, input.until, input.prices!).totalNok : null;
  return { kwh, nok: nok == null ? null : Math.round(nok) };
}
