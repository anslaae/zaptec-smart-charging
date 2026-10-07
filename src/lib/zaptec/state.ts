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

// There's no API command to authorize a brand-new session -- only to
// pause/resume one that's already running. So with "Require authentication"
// on, this app only has real control while a session already exists (started
// by someone tapping an RFID tag or the Zaptec app); with it off (free
// charging), every plug-in auto-starts a session and the app is always in
// control. Defaults to "in control" when the setting is unknown (a failed
// lookup) rather than falsely alarming the user over a transient API error.
export function appHasControl(state: ChargerState): boolean {
  if (state.installationRequiresAuth !== true) return true;
  return isCurrentlyCharging(state) || isPausedAndResumable(state);
}

export function describeOperationMode(state: ChargerState): string {
  if (!state.isOnline) return "Offline";
  switch (state.operationMode) {
    case ChargerOperationMode.Disconnected:
      return "No car connected";
    case ChargerOperationMode.ConnectedRequesting:
      return "Plugged in, waiting to charge";
    case ChargerOperationMode.Charging:
      return "Charging";
    case ChargerOperationMode.StoppedOrIdle:
      return state.finalStopActive ? "Connected, paused" : "Connected, idle";
    default:
      return "Unknown";
  }
}
