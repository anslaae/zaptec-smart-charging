// D75: an unexpected stop while charging was asked for is always visible.
// Pure rules shared by the tick (which keeps charge_incidents and sends the
// one push) and Hjem (which shows the card), so both agree. Design:
// design/redesign/HANDOFF.md §6e.
//
// - What is wanted: an open Lad nå / automatic row, or a plan / Smart lading
//   whose last command was a start (or that is stuck: D64 start failed). A
//   Forvarm has its own check (D68), a guest window none.
// - Which incident: fault before car -- the loop guard or Zaptec's restart
//   lock ("locked"), a start that didn't take (D64), the charger offline, a
//   charger warning (D73) while it isn't charging; otherwise "car" when the
//   car isn't drawing power.
// - When it shows and pushes: see incidentStatus.

import { ChargerOperationMode } from "@/lib/zaptec/constants";
import type { ChargerState } from "@/lib/zaptec/types";
import { warningNames } from "@/lib/zaptec/health";
import { isDrawingPower, POWER_LOST_AFTER_MS } from "@/lib/scheduler/preheatPower";

export type IncidentKind = "car" | "start_failed" | "offline" | "locked" | "charger_warning";

/** Fault = the charger, Zaptec or the app failed; car = the car stopped taking power. */
export const FAULT_KINDS: ReadonlySet<IncidentKind> = new Set(["start_failed", "offline", "locked", "charger_warning"]);

/** The car-level cases (HANDOFF §6e): Lad nå cases 1-4, and a plan / Smart / automatic stopped before its target. */
export type CarCase = "full" | "stopped" | "idle" | "never" | "declinedPlan";

/** A Lad nå / plan start: the car gets this long to pick it up before a stop counts. */
export const REQUEST_SETTLE_MS = POWER_LOST_AFTER_MS;
/** Lad nå case 4: no energy this long after the tap. */
export const NEVER_STARTED_AFTER_MS = 5 * 60_000;
/** Lad nå case 3: idling this long below full turns into case 2. */
export const IDLE_LIMIT_MS = 30 * 60_000;
/** Case 1: the Lad nå session closes itself this long after the car stopped. */
export const AUTO_END_AFTER_MS = 30 * 60_000;
/** Offline this long while charging is wanted. */
export const OFFLINE_AFTER_MS = 10 * 60_000;
/** Case 1: at or above this battery % (or the last plan's target) the car is probably full. */
export const FULL_PERCENT = 95;
/** Less than this counts as "0 kWh" (case 4). */
const NO_ENERGY_KWH = 0.05;

/** What is asked for on this charger right now. */
export type Wanted =
  | {
      type: "session";
      id: string;
      /** "manual" = Lad nå, "automatic" = Lad med en gang (UC14). */
      kind: "manual" | "automatic";
      /** When it was asked for (the row's start). */
      requestedAt: Date;
      /** Energy this row has delivered so far. */
      deliveredKwh: number;
    }
  | {
      type: "schedule";
      id: string;
      /** The last start command the plan sent (null if it never got one). */
      requestedAt: Date | null;
      /** D64: the plan gave up starting. */
      startFailed: boolean;
    };

export function subjectKey(wanted: Wanted | null): string {
  if (!wanted) return "charger";
  return `${wanted.type}:${wanted.id}`;
}

type StateIn = Pick<
  ChargerState,
  "operationMode" | "instantPowerWatts" | "phaseCurrentsAmps" | "isOnline" | "finalStopActive" | "health"
>;

/** Zaptec's own "stopped too many times" lock (warning 16) behaves like the loop guard. */
function zaptecLocked(state: StateIn): boolean {
  return warningNames(state.health?.warnings).includes("WARNING_MAX_SESSION_RESTART");
}

/**
 * The one incident this charger has now, if any (fault outranks car).
 * guardPaused = the D65 loop guard holds the app's commands back.
 */
export function currentIncident(input: { state: StateIn; wanted: Wanted | null; guardPaused: boolean }): IncidentKind | null {
  const { state, wanted, guardPaused } = input;
  const connected = state.operationMode !== ChargerOperationMode.Disconnected;
  if (guardPaused && connected) return "locked";
  if (!wanted) return null;
  if (!state.isOnline) return "offline";
  if (!connected) return null;
  if (zaptecLocked(state)) return "locked";
  const drawing = isDrawingPower(state);
  if (wanted.type === "schedule" && wanted.startFailed) {
    // The plan's starts went out, the charger took them (no final stop latched)
    // and says the car isn't asking (mode 5): the car declined, not a fault.
    const carDeclined = state.operationMode === ChargerOperationMode.StoppedOrIdle && !state.finalStopActive;
    if (!carDeclined) return "start_failed";
  }
  if (!drawing && (state.health?.warnings ?? 0) > 0) return "charger_warning";
  if (!drawing) return "car";
  return null;
}

export interface IncidentStatus {
  /** Show the card / status on Hjem. */
  visible: boolean;
  /** Car incidents: which case. */
  carCase: CarCase | null;
  /** This status calls for the incident's one push (and its activity line). */
  pushes: boolean;
  /** Case 1: when the Lad nå session closes itself (if the car still isn't drawing). */
  autoEndAt: Date | null;
}

const HIDDEN: IncidentStatus = { visible: false, carCase: null, pushes: false, autoEndAt: null };

/**
 * How an open incident reads now. since = when it was first seen.
 * batteryPercent = the estimate including this session's energy;
 * targetPercent = the last plan's target (case 1 "or at the last plan's target").
 */
export function incidentStatus(input: {
  kind: IncidentKind;
  since: Date;
  state: StateIn;
  wanted: Wanted | null;
  batteryPercent: number | null;
  targetPercent: number | null;
  now: Date;
}): IncidentStatus {
  const { kind, since, state, wanted, now } = input;
  const age = now.getTime() - since.getTime();
  if (kind === "offline") return age >= OFFLINE_AFTER_MS ? { ...HIDDEN, visible: true, pushes: true } : HIDDEN;
  if (kind !== "car") return { ...HIDDEN, visible: true, pushes: true };
  if (!wanted) return HIDDEN;

  const sinceRequest = wanted.requestedAt ? now.getTime() - wanted.requestedAt.getTime() : Infinity;
  const finished = state.operationMode === ChargerOperationMode.StoppedOrIdle;
  // "Not drawing" = mode 5 at once, otherwise after 2 min with no power (D68).
  const stopped = finished || age >= POWER_LOST_AFTER_MS;
  const full =
    input.batteryPercent != null &&
    (input.batteryPercent >= FULL_PERCENT || (input.targetPercent != null && input.batteryPercent >= input.targetPercent));

  if (wanted.type === "schedule") {
    // The charger still latched by our own stop never carried out the start:
    // that's D64's "start failed" (after its tries), not the car declining.
    // A full car has in effect reached the target (the plan ends at its kWh).
    if (state.finalStopActive || sinceRequest < REQUEST_SETTLE_MS || !stopped || full) return HIDDEN;
    return { visible: true, carCase: "declinedPlan", pushes: true, autoEndAt: null };
  }

  if (wanted.deliveredKwh < NO_ENERGY_KWH) {
    return sinceRequest >= NEVER_STARTED_AFTER_MS ? { visible: true, carCase: "never", pushes: true, autoEndAt: null } : HIDDEN;
  }
  if (sinceRequest < REQUEST_SETTLE_MS || !stopped) return HIDDEN;
  // An automatic session reads like a plan (HANDOFF §6e): stopped before its target.
  if (wanted.kind === "automatic") {
    return full ? HIDDEN : { visible: true, carCase: "declinedPlan", pushes: true, autoEndAt: null };
  }
  if (full) {
    return { visible: true, carCase: "full", pushes: true, autoEndAt: new Date(since.getTime() + AUTO_END_AFTER_MS) };
  }
  if (finished || age >= IDLE_LIMIT_MS) return { visible: true, carCase: "stopped", pushes: true, autoEndAt: null };
  return { visible: true, carCase: "idle", pushes: false, autoEndAt: null };
}
