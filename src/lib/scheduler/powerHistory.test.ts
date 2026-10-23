import { describe, expect, it } from "vitest";
import { computeLearnedPowerKw, type RealizedChargeSample } from "./powerHistory";

function sample(remainingKwhAtStart: number, hours: number): RealizedChargeSample {
  const startedAt = new Date("2026-01-01T00:00:00Z");
  return {
    remainingKwhAtStart,
    startedAt,
    endedAt: new Date(startedAt.getTime() + hours * 3_600_000),
  };
}

describe("computeLearnedPowerKw", () => {
  it("returns null with no samples", () => {
    expect(computeLearnedPowerKw([])).toBeNull();
  });

  it("returns the rate for a single sample", () => {
    // 17 kWh over 368 minutes (the real session this was built from) ≈ 2.77 kW.
    expect(computeLearnedPowerKw([sample(17, 368 / 60)])).toBeCloseTo(2.77, 1);
  });

  it("returns the median, not the mean, so one outlier doesn't skew it", () => {
    const samples = [sample(10, 10), sample(10, 10), sample(100, 1)]; // 1 kW, 1 kW, 100 kW outlier
    expect(computeLearnedPowerKw(samples)).toBeCloseTo(1, 5);
  });

  it("ignores a zero-duration sample instead of dividing by zero", () => {
    expect(computeLearnedPowerKw([sample(5, 0), sample(10, 5)])).toBeCloseTo(2, 5);
  });
});
