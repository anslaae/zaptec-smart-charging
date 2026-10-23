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
