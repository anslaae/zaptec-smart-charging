import { isDrawing, type StateLogPoint } from "./chargingSince";

// Pure, unit-testable (no "server-only", no DB) -- mirrors engine.ts.
//
// state.maxPowerKw (used as the fallback power in estimateChargingPlan) is
// derived from the charger/circuit's current limits -- a theoretical
// ceiling, not what the car actually draws. Measured against this
// household's own completed sessions, the car's onboard charger drew
// 40-65% less than that ceiling. This learns the real rate from recent
// history instead.

export interface RealizedChargeSample {
  /** estimateChargingPlan()'s remainingKwh, captured when charging started. */
  remainingKwhAtStart: number;
  startedAt: Date;
  endedAt: Date;
}

/**
 * The median realized kW across the given samples, or null if there aren't
 * any usable ones. Median rather than mean so a single outlier session
 * (e.g. an odd Zaptec power dip) doesn't skew every future estimate.
 */
export function computeLearnedPowerKw(samples: RealizedChargeSample[]): number | null {
  const rates = samples
    .map((sample) => {
      const hours = (sample.endedAt.getTime() - sample.startedAt.getTime()) / 3_600_000;
      return hours > 0 ? sample.remainingKwhAtStart / hours : null;
    })
    .filter((rate): rate is number => rate != null && rate > 0)
    .sort((a, b) => a - b);

  if (rates.length === 0) return null;

  const mid = Math.floor(rates.length / 2);
  return rates.length % 2 === 0 ? (rates[mid - 1] + rates[mid]) / 2 : rates[mid];
}

// D85: the learned rate from what the charger measured while the car drew
// power, not from wall-clock time. The old rate (remainingKwhAtStart / the
// plan's whole duration) counted waiting, ramp-up and the slow tail near
// 100 % as charging time, so it came out at ~2.8 kW for a car that draws
// ~4.4 kW, and Smart lading planned the whole night instead of the cheapest
// hours. Chosen: the time-weighted median of charger_state_log's power_kw
// over the stretches where the car drew power (mode 3, > 0.3 kW). Rejected:
// delivered kWh / drawing hours -- that is the mean, which a long 1-2 kW tail
// (charging to 100 %) or a ramp still drags down, and it depends on the
// plan's energy bookkeeping across re-plugs. The median is the rate the car
// holds for most of a charge, which is what the planner needs.

/** Less drawing time than this in a plan isn't a usable sample. */
export const MIN_DRAWING_MS = 5 * 60_000;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Time-weighted median kW while the car drew power between startedAt and
 * endedAt. Each log row holds until the next one (the log only writes on a
 * change), so pass the last row at or before startedAt too. Null with less
 * than MIN_DRAWING_MS of drawing.
 */
export function drawingPowerKw(rows: StateLogPoint[], startedAt: Date, endedAt: Date): number | null {
  const sorted = [...rows].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const segments: { kw: number; ms: number }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    if (!isDrawing(row)) continue;
    const from = Math.max(row.observedAt.getTime(), startedAt.getTime());
    const to = Math.min(sorted[i + 1]?.observedAt.getTime() ?? endedAt.getTime(), endedAt.getTime());
    if (to > from) segments.push({ kw: row.powerKw!, ms: to - from });
  }
  const total = segments.reduce((sum, s) => sum + s.ms, 0);
  if (total < MIN_DRAWING_MS) return null;
  segments.sort((a, b) => a.kw - b.kw);
  let acc = 0;
  for (const s of segments) {
    acc += s.ms;
    if (acc >= total / 2) return s.kw;
  }
  return segments[segments.length - 1].kw;
}

/** The pre-D85 sample for one plan (whole wall-clock duration), for plans older than the state log. */
export function wallClockKw(sample: RealizedChargeSample): number | null {
  const hours = (sample.endedAt.getTime() - sample.startedAt.getTime()) / 3_600_000;
  return hours > 0 && sample.remainingKwhAtStart > 0 ? sample.remainingKwhAtStart / hours : null;
}
