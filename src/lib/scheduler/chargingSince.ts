// D84: "charging since" without Zaptec's ChargeDuration (observation 701),
// which this charger never reports -- so state.chargeDurationSeconds is null
// in production. Derived from the app's own charger_state_log (D69) instead.
// Pure, unit tested; the DB side is chargingSince.server.ts.

import { ChargerOperationMode } from "@/lib/zaptec/constants";
import type { ChargerState } from "@/lib/zaptec/types";
import { STATE_LOG_POWER_KW } from "./stateLog";

export interface StateLogPoint {
  observedAt: Date;
  operationMode: number | null;
  powerKw: number | null;
}

/** A state-log row that means "the car is drawing power" (mode 3, above the log's own noise threshold). */
export function isDrawing(row: Pick<StateLogPoint, "operationMode" | "powerKw">): boolean {
  return row.operationMode === ChargerOperationMode.Charging && (row.powerKw ?? 0) > STATE_LOG_POWER_KW;
}

/**
 * Start of the current run of "drawing" rows: walk back from the newest row
 * while rows are drawing; the oldest of that run is when it began. Null when
 * the newest row isn't drawing (the log hasn't caught up with this charge yet).
 * `rows` may come in any order.
 */
export function chargingSinceFromLog(rows: StateLogPoint[]): Date | null {
  const newestFirst = [...rows].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
  let since: Date | null = null;
  for (const row of newestFirst) {
    if (!isDrawing(row)) break;
    since = row.observedAt;
  }
  return since;
}

/**
 * The state with chargeDurationSeconds filled in when Zaptec didn't report it
 * and the car is charging: from the state log run, else the latest start the
 * app itself recorded (a plan's startedAt or a session row's startedAt).
 * A Zaptec value always wins; nothing is filled when not charging.
 */
export function withChargeDuration(
  state: ChargerState,
  logSince: Date | null,
  fallbackSince: Date | null,
  now: Date,
): ChargerState {
  if (state.chargeDurationSeconds != null) return state;
  if (state.operationMode !== ChargerOperationMode.Charging) return state;
  const since = logSince ?? fallbackSince;
  if (!since || since.getTime() > now.getTime()) return state;
  return { ...state, chargeDurationSeconds: Math.round((now.getTime() - since.getTime()) / 1000) };
}
