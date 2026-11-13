// D69: when the tick writes a charger_state_log row -- only when something
// meaningful changed since the last row, never just because a minute passed.
// Pure, unit tested.

import type { ChargerState } from "@/lib/zaptec/types";

export const STATE_LOG_RETENTION_MS = 30 * 24 * 3_600_000;
/** A power change bigger than this is worth a row. */
export const STATE_LOG_POWER_KW = 0.3;
/** A phase current crossing this (up or down) is worth a row: idle vs drawing. */
export const STATE_LOG_PHASE_AMPS = 0.5;

export interface LoggedState {
  operationMode: number | null;
  powerKw: number | null;
  phaseAmps: (number | null)[];
  finalStopActive: boolean | null;
  sessionId: string | null;
}

export function toLoggedState(state: ChargerState): LoggedState {
  return {
    operationMode: state.operationMode,
    powerKw: state.instantPowerWatts == null ? null : Math.round(state.instantPowerWatts / 10) / 100,
    phaseAmps: [0, 1, 2].map((i) => state.phaseCurrentsAmps?.[i] ?? null),
    finalStopActive: state.finalStopActive,
    sessionId: state.sessionId,
  };
}

export function stateLogChanged(prev: LoggedState | null, next: LoggedState): boolean {
  if (prev == null) return true;
  if (prev.operationMode !== next.operationMode) return true;
  if (prev.finalStopActive !== next.finalStopActive) return true;
  if (prev.sessionId !== next.sessionId) return true;
  if ((prev.powerKw == null) !== (next.powerKw == null)) return true;
  if (prev.powerKw != null && next.powerKw != null && Math.abs(prev.powerKw - next.powerKw) > STATE_LOG_POWER_KW) {
    return true;
  }
  return [0, 1, 2].some((i) => {
    const a = prev.phaseAmps[i] ?? null;
    const b = next.phaseAmps[i] ?? null;
    if (a == null || b == null) return (a == null) !== (b == null);
    return a < STATE_LOG_PHASE_AMPS !== b < STATE_LOG_PHASE_AMPS;
  });
}
