import type { ChargerState } from "@/lib/zaptec/types";
import { ObservationId } from "@/lib/zaptec/constants";

// Innstillinger → Bil og lader (HANDOFF §6g): the pure parts of the two
// detail pages. Unit tested in carCharger.test.ts.

/** Which step of the power fallback chain a plan's estimate uses right now. */
export type PowerSource = "observed" | "learned" | "circuit" | "default";

export const POWER_CHAIN: readonly PowerSource[] = ["observed", "learned", "circuit", "default"];

/**
 * The step in use, in the order estimateChargingPlan() (src/lib/scheduler/engine.ts)
 * picks its power: the live reading while charging, the learned rate, the
 * circuit's max, then DEFAULT_ASSUMED_POWER_KW.
 */
export function activePowerSource(
  state: Pick<ChargerState, "instantPowerWatts" | "maxPowerKw"> | null,
  learnedPowerKw: number | null,
): PowerSource {
  if (state?.instantPowerWatts && state.instantPowerWatts > 0) return "observed";
  if (learnedPowerKw != null) return "learned";
  if (state?.maxPowerKw != null) return "circuit";
  return "default";
}

const NOMINAL_VOLTAGE = 230;

/** Phases from MaxPhases (520, a bitmask) and the amps behind maxPowerKw; null when unknown. */
export function circuitLimit(
  state: Pick<ChargerState, "maxPowerKw" | "rawObservations"> | null,
): { amps: number; phases: number } | null {
  const raw = state?.rawObservations?.[String(ObservationId.MaxPhases)];
  const mask = raw != null ? Number(raw) : NaN;
  if (!Number.isFinite(mask) || mask <= 0 || state?.maxPowerKw == null) return null;
  let phases = 0;
  for (let bit = mask; bit > 0; bit >>= 1) phases += bit & 1;
  if (phases === 0) return null;
  return { amps: Math.round((state.maxPowerKw * 1000) / (phases * NOMINAL_VOLTAGE)), phases };
}

export interface PowerSpread {
  min: number;
  max: number;
  median: number;
}

/** Min, max and median of the learned-power samples, for the dot plot; null with none. */
export function powerSpread(values: number[]): PowerSpread | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { min: sorted[0], max: sorted[sorted.length - 1], median };
}

export interface PlugEvent {
  type: "plugged_in" | "unplugged";
  at: Date;
}

export interface CarConnection {
  connected: boolean;
  /** When the car was plugged in (connected) or last plugged in (not), if known. */
  pluggedInAt: Date | null;
  /** The last unplug, when not connected. */
  unpluggedAt: Date | null;
}

/**
 * Connected or not, from the charger's own plug-in/unplug activity lines
 * (the tick logs them, so this needs no Zaptec call). Events in any order.
 */
export function carConnection(events: PlugEvent[]): CarConnection {
  const sorted = [...events].sort((a, b) => b.at.getTime() - a.at.getTime());
  const latest = sorted[0];
  if (!latest) return { connected: false, pluggedInAt: null, unpluggedAt: null };
  if (latest.type === "plugged_in") return { connected: true, pluggedInAt: latest.at, unpluggedAt: null };
  const before = sorted.find((e) => e.type === "plugged_in" && e.at.getTime() <= latest.at.getTime());
  return { connected: false, pluggedInAt: before?.at ?? null, unpluggedAt: latest.at };
}
