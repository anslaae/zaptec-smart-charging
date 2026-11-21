// D86: stop at the target from the car's own battery reading, and correct
// drift between the reading and what the plan expected. Pure, unit tested;
// the DB side is socTarget.server.ts.
//
// Never a source of start/pause commands (D64/D65): the only outcomes are
// "complete" (the caller ends the plan through its one terminal
// StopChargingFinal) and "retarget" (a new target kWh, written to the row,
// at most once per ADJUST_MIN_INTERVAL_MS and only for a reading newer than
// the last one acted on). Old readings, readings from before charging
// started and repeated identical readings give "none".

import { isDrawing, type StateLogPoint } from "./chargingSince";
import { median } from "./powerHistory";

/** A reading counts only if the car took it this long after charging started. */
export const READING_AFTER_START_MS = 2 * 60_000;
/** Correct the target when the reading is this many points off what we expected. */
export const DRIFT_POINTS = 5;
/** At most one correction per this interval (as maybeReplan). */
export const ADJUST_MIN_INTERVAL_MS = 10 * 60_000;

export interface BatteryReading {
  percent: number;
  oemUpdatedAt: Date;
}

/** Stored as soc_adjust on the row after a correction (the next one's baseline and rate limit). */
export interface SocAdjust {
  /** When the correction was made. */
  at: string;
  /** The reading it was made from (oemUpdatedAt). */
  readingAt: string;
  percent: number;
  /** Plan kWh delivered at the reading's time (estimated). */
  delivered: number;
}

export type ReadingAction =
  | { kind: "none"; why: string }
  /** Only ever from a measured reading at/over the target % -- never from drift arithmetic. */
  | { kind: "complete"; percent: number }
  | { kind: "retarget"; targetKwh: number; adjust: SocAdjust };

/** A drift correction lowers the target by at most this many points' worth at a time. */
export const MAX_LOWER_POINTS = 10;
/** A drift correction always leaves at least this many points' worth to charge. */
export const MIN_LEFT_POINTS = 1;

/**
 * kWh the car drew between `from` (the reading) and `to` (now), from the
 * measured state log: each row's power holds until the next row (the log
 * writes on any mode change or a > 0.3 kW step), counted only while drawing.
 * Null when no row is in force at `from` (no measured history to go on) --
 * then drift is skipped. Never a guess from today's power: after a pause or
 * a power change that guess was far too low (H1).
 */
export function drawnKwhBetween(rows: StateLogPoint[], from: Date, to: Date): number | null {
  const sorted = [...rows].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  if (!sorted.some((r) => r.observedAt.getTime() <= from.getTime())) return null;
  let kwh = 0;
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    if (!isDrawing(row)) continue;
    const a = Math.max(row.observedAt.getTime(), from.getTime());
    const b = Math.min(sorted[i + 1]?.observedAt.getTime() ?? to.getTime(), to.getTime());
    if (b > a) kwh += row.powerKw! * ((b - a) / 3_600_000);
  }
  return kwh;
}

/** Plan kWh delivered at the reading's time: delivered now minus what was measured since. Null = unknown. */
export function deliveredAtReading(input: { deliveredKwh: number; drawnSinceKwh: number | null; floor: number }): number | null {
  if (input.drawnSinceKwh == null) return null;
  return Math.min(input.deliveredKwh, Math.max(input.floor, input.deliveredKwh - input.drawnSinceKwh));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function readingDecision(input: {
  reading: BatteryReading | null;
  /** When charging started for this plan/session; null = it hasn't. */
  chargingStartedAt: Date | null;
  targetPercent: number | null;
  /** The plan's starting % (the drift baseline before any correction); null = unknown. */
  startPercent: number | null;
  deliveredKwh: number;
  /** See deliveredAtReading; null = no measured history, so no drift correction. */
  deliveredAtReadingKwh: number | null;
  /** The current target kWh; null = none (charge until the car stops). */
  targetKwh: number | null;
  kwhPerPercent: number;
  lastAdjust: SocAdjust | null;
  /** False for Smart rows: maybeReplan re-plans their blocks instead. */
  allowRetarget: boolean;
  now: Date;
}): ReadingAction {
  const { reading, chargingStartedAt, targetPercent, kwhPerPercent: kpp } = input;
  if (!reading || targetPercent == null) return { kind: "none", why: "no reading or target" };
  if (!chargingStartedAt) return { kind: "none", why: "not started" };
  if (reading.oemUpdatedAt.getTime() <= chargingStartedAt.getTime() + READING_AFTER_START_MS) {
    return { kind: "none", why: "reading from before charging started" };
  }
  if (reading.percent >= targetPercent) return { kind: "complete", percent: reading.percent };
  if (!input.allowRetarget || kpp <= 0) return { kind: "none", why: "no retarget" };

  const last = input.lastAdjust;
  if (last && reading.oemUpdatedAt.getTime() <= Date.parse(last.readingAt)) return { kind: "none", why: "reading already used" };
  if (last && input.now.getTime() - Date.parse(last.at) < ADJUST_MIN_INTERVAL_MS) return { kind: "none", why: "rate limited" };

  const atReading = input.deliveredAtReadingKwh;
  if (atReading == null) return { kind: "none", why: "no measured energy at the reading" };
  const baseline = last
    ? { percent: last.percent, delivered: last.delivered }
    : input.startPercent != null
      ? { percent: input.startPercent, delivered: 0 }
      : null;
  // No baseline and no target yet (automatic session opened without a reading): the first fresh reading sets one.
  if (baseline) {
    const expected = baseline.percent + (atReading - baseline.delivered) / kpp;
    if (Math.abs(reading.percent - expected) <= DRIFT_POINTS) return { kind: "none", why: "within drift" };
  } else if (input.targetKwh != null) {
    return { kind: "none", why: "no baseline" };
  }

  const wanted = atReading + (targetPercent - reading.percent) * kpp;
  const ceiling = atReading + (100 - reading.percent) * kpp;
  let targetKwh = Math.min(wanted, ceiling);
  // Drift never ends a plan (only a measured reading >= target does): it
  // lowers the target by at most MAX_LOWER_POINTS' worth per correction and
  // always leaves at least MIN_LEFT_POINTS' worth to charge.
  if (input.targetKwh != null) targetKwh = Math.max(targetKwh, input.targetKwh - MAX_LOWER_POINTS * kpp);
  targetKwh = round2(Math.max(targetKwh, input.deliveredKwh + MIN_LEFT_POINTS * kpp));
  if (input.targetKwh != null && Math.abs(targetKwh - input.targetKwh) < 0.05) return { kind: "none", why: "same target" };
  return {
    kind: "retarget",
    targetKwh,
    adjust: {
      at: input.now.toISOString(),
      readingAt: reading.oemUpdatedAt.toISOString(),
      percent: reading.percent,
      delivered: round2(atReading),
    },
  };
}

// --- Learned kWh per battery % ----------------------------------------------

/** A reading this close before a plan started / after it ended brackets it. */
export const BRACKET_MS = 90 * 60_000;
export const KWH_PER_PERCENT_SAMPLES = 10;
export const KWH_PER_PERCENT_MIN_SAMPLES = 3;
/** Fewer points than this between the readings is too coarse (1 % steps) to learn from. */
export const MIN_DELTA_PERCENT = 5;

export interface KwhPerPercentSample {
  /** Wall kWh the plan delivered. */
  kwh: number;
  deltaPercent: number;
}

/**
 * kWh from the wall per battery %: the median of the newest
 * KWH_PER_PERCENT_SAMPLES samples, with at least KWH_PER_PERCENT_MIN_SAMPLES,
 * clamped to [0.8, 1.2] × capacity/100. Otherwise capacity/100.
 * `samples` newest first.
 */
export function learnKwhPerPercent(samples: KwhPerPercentSample[], capacityKwh: number): number {
  const nominal = capacityKwh / 100;
  const values = samples
    .filter((s) => s.kwh > 0 && s.deltaPercent >= MIN_DELTA_PERCENT)
    .slice(0, KWH_PER_PERCENT_SAMPLES)
    .map((s) => s.kwh / s.deltaPercent);
  if (values.length < KWH_PER_PERCENT_MIN_SAMPLES) return nominal;
  const m = median(values)!;
  return Math.min(1.2 * nominal, Math.max(0.8 * nominal, m));
}

/**
 * The reading pair around one plan: the latest at most BRACKET_MS before it
 * started and the earliest at most BRACKET_MS after it ended. Null when
 * either side is missing. `readings` in any order.
 */
export function bracketReadings(
  readings: BatteryReading[],
  startedAt: Date,
  endedAt: Date,
): { before: BatteryReading; after: BatteryReading } | null {
  const s = startedAt.getTime();
  const e = endedAt.getTime();
  let before: BatteryReading | null = null;
  let after: BatteryReading | null = null;
  for (const r of readings) {
    const t = r.oemUpdatedAt.getTime();
    if (t <= s && t >= s - BRACKET_MS && (!before || t > before.oemUpdatedAt.getTime())) before = r;
    if (t >= e && t <= e + BRACKET_MS && (!after || t < after.oemUpdatedAt.getTime())) after = r;
  }
  return before && after ? { before, after } : null;
}
