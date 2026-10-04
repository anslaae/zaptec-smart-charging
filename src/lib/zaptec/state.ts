import { ChargerOperationMode } from "./constants";
import type { ChargerState } from "./types";

export function isCurrentlyCharging(state: ChargerState): boolean {
  return state.operationMode === ChargerOperationMode.Charging;
}

export function isPausedAndResumable(state: ChargerState): boolean {
  return (
    state.operationMode === ChargerOperationMode.StoppedOrIdle &&
    state.finalStopActive === true
  );
}

export function describeOperationMode(state: ChargerState): string {
  if (!state.isOnline) return "Offline";
  switch (state.operationMode) {
    case ChargerOperationMode.Disconnected:
      return "No car connected";
    case ChargerOperationMode.Charging:
      return "Charging";
    case ChargerOperationMode.StoppedOrIdle:
      return state.finalStopActive ? "Connected, paused" : "Connected, idle";
    default:
      return "Unknown";
  }
}
