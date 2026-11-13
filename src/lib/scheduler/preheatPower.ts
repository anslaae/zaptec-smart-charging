// D68: Forvarm only warms from the grid while the car itself draws power. On
// 13 Nov 2026 the Opel stopped requesting power six minutes into a Forvarm
// (charger mode 5) and ran the cabin heater on its battery while the app
// still said "Forvarming". The app can't make the car draw (a ResumeCharging
// is ignored by a finished car and risks the D64/D65 loop), so it only
// notices and tells: an amber line on Hjem / in the sheet and one push per
// Forvarm. Pure, unit tested; the tick and Hjem both use it.

import type { ChargerState } from "@/lib/zaptec/types";
import { ChargerOperationMode } from "@/lib/zaptec/constants";

/** No power for this long (car connected) counts as "stopped drawing". */
export const POWER_LOST_AFTER_MS = 2 * 60_000;
/** Below this the car isn't really drawing (standby noise). */
export const DRAWING_MIN_WATTS = 100;
/** D69: every phase below this is idle (production idle reads ~0.03-0.05 A). */
export const DRAWING_MIN_AMPS = 0.5;

type PowerState = Pick<ChargerState, "operationMode" | "instantPowerWatts" | "phaseCurrentsAmps">;

/**
 * Drawing = the charger says "charging" and neither the power (< 0.1 kW) nor
 * the phase currents (all < 0.5 A, D69) say it's idle. The currents catch a
 * car that stopped while the mode lags or stays at 3.
 */
export function isDrawingPower(state: PowerState): boolean {
  if (state.operationMode !== ChargerOperationMode.Charging) return false;
  if (state.instantPowerWatts != null && state.instantPowerWatts < DRAWING_MIN_WATTS) return false;
  const phases = (state.phaseCurrentsAmps ?? []).filter((a): a is number => a != null);
  if (phases.length > 0 && phases.every((a) => a < DRAWING_MIN_AMPS)) return false;
  return true;
}

/**
 * One Forvarm's power check. lostAt is when the car was first seen not
 * drawing (kept across ticks, cleared when it draws again). It counts as "on
 * battery" when the charger says the car finished (mode 5) or after 2 min
 * without power -- but not in the first 2 min of a Forvarm (startedAt), while
 * the car is still picking up the start. notify is true once per Forvarm:
 * when it first counts and no push has gone out yet (notifiedAt).
 */
export function preheatPowerCheck(input: {
  state: PowerState;
  lostAt: Date | null;
  notifiedAt: Date | null;
  startedAt: Date | null;
  now: Date;
}): { lostAt: Date | null; onBattery: boolean; notify: boolean } {
  const { state, notifiedAt, startedAt, now } = input;
  if (state.operationMode === ChargerOperationMode.Disconnected || isDrawingPower(state)) {
    return { lostAt: null, onBattery: false, notify: false };
  }
  const lostAt = input.lostAt ?? now;
  const settled = startedAt == null || now.getTime() - startedAt.getTime() >= POWER_LOST_AFTER_MS;
  const finished = state.operationMode === ChargerOperationMode.StoppedOrIdle;
  const onBattery = settled && (finished || now.getTime() - lostAt.getTime() >= POWER_LOST_AFTER_MS);
  return { lostAt, onBattery, notify: onBattery && notifiedAt == null };
}
