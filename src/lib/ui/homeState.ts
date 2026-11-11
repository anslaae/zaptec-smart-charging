import type { ChargerState } from "@/lib/zaptec/types";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import { appHasControl, isCurrentlyCharging } from "@/lib/zaptec/state";

// Which of the Hjem screen's states a charger is in -- one hero card and one
// primary action per state (design/redesign/HANDOFF.md §3). Pure, so every
// state is unit-tested and the debug scenarios can preview each one.
export type HomeState =
  | "noControl"
  | "noCar"
  | "planWaiting"
  | "connected"
  | "planned"
  | "chargingPlan"
  | "chargingManual"
  | "preheating"
  | "ready"
  | "guest"
  | "smartWaiting"
  | "smartCharging";

export const HOME_STATES: readonly HomeState[] = [
  "noControl",
  "noCar",
  "planWaiting",
  "connected",
  "planned",
  "chargingPlan",
  "chargingManual",
  "preheating",
  "ready",
  "guest",
  "smartWaiting",
  "smartCharging",
];

export interface HomeStateInput {
  state: ChargerState;
  /** The charger's open plan, if any (createSchedule allows at most one pending/active per charger). */
  schedule: { status: "pending" | "active" | "completed" | "cancelled"; source?: string } | null;
  /** The open manual_charge_sessions row, if any (see src/lib/sessions.ts). */
  openSession: { kind: "manual" | "preheat" | "guest" | "automatic" } | null;
  /** zaptec_session_id of the most recently completed plan, to recognise "just finished, still plugged in". */
  lastCompletedPlanSessionId: string | null;
}

export function homeState({ state, schedule, openSession, lastCompletedPlanSessionId }: HomeStateInput): HomeState {
  if (!appHasControl(state)) return "noControl";

  const disconnected = state.operationMode === ChargerOperationMode.Disconnected;
  const charging = isCurrentlyCharging(state);

  // UC15: a guest window lasts until the guest unplugs, and is open before they arrive too.
  if (openSession?.kind === "guest") return "guest";

  // Other sessions are closed on unplug, so they only count while connected.
  // An automatic session (UC14) reads like Lad nå: charging, one Stopp button.
  if (openSession && !disconnected) {
    return openSession.kind === "preheat" ? "preheating" : "chargingManual";
  }

  const openPlan = schedule && (schedule.status === "pending" || schedule.status === "active") ? schedule : null;
  if (openPlan?.source === "smart") {
    // Smart lading (UC16): one row per plug-in session, gone when unplugged.
    if (disconnected) return "noCar";
    return openPlan.status === "active" && charging ? "smartCharging" : "smartWaiting";
  }
  if (openPlan) {
    if (disconnected) return "planWaiting";
    // An active plan that the scheduler has paused (waiting for its next
    // window) reads as planned, not charging.
    return openPlan.status === "active" && charging ? "chargingPlan" : "planned";
  }

  if (disconnected) return "noCar";

  // Same physical plug-in as the plan that just completed -> the car is ready.
  if (lastCompletedPlanSessionId != null && state.sessionId != null && lastCompletedPlanSessionId === state.sessionId) {
    return "ready";
  }

  // Includes a free-charging session that started on plug-in without a plan:
  // the scheduler stops it within a tick, so the household sees "connected".
  return "connected";
}
