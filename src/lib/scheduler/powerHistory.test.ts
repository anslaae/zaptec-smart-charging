import { describe, expect, it } from "vitest";
import { computeLearnedPowerKw, drawingPowerKw, median, wallClockKw, type RealizedChargeSample } from "./powerHistory";

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

describe("drawingPowerKw (D85)", () => {
  const t0 = new Date("2026-11-19T22:25:00Z");
  const at = (min: number) => new Date(t0.getTime() + min * 60_000);
  const row = (min: number, mode: number, kw: number) => ({ observedAt: at(min), operationMode: mode, powerKw: kw });

  it("a car drawing ~4.4 kW learns ~4.4, not the wall-clock 2.8 (waiting, ramp and tail don't count)", () => {
    // 19-20 Nov shape: plugged in 22:25, waits, draws 4.36-4.40 kW for ~4.5 h,
    // a short tail at 2 kW, then idle until the plan ended at 06:00.
    const rows = [
      row(0, 2, 0),
      row(60, 3, 4.36),
      row(150, 3, 4.4),
      row(330, 3, 2.0),
      row(345, 5, 0),
    ];
    const kw = drawingPowerKw(rows, at(0), at(455))!;
    expect(kw).toBeGreaterThanOrEqual(4.3);
    expect(kw).toBeLessThanOrEqual(4.4);
    // The pre-D85 wall-clock sample for the same plan: ~17.9 kWh over 7.6 h.
    expect(wallClockKw({ remainingKwhAtStart: 17.9, startedAt: at(0), endedAt: at(455) })).toBeLessThan(2.5);
  });

  it("uses the row in force at the start, and ignores time outside the plan", () => {
    const rows = [row(-30, 3, 4.4), row(40, 5, 0)];
    expect(drawingPowerKw(rows, at(0), at(60))).toBe(4.4);
  });

  it("null with under 5 min of drawing", () => {
    expect(drawingPowerKw([row(0, 3, 4.4), row(4, 5, 0)], at(0), at(60))).toBeNull();
    expect(drawingPowerKw([row(0, 5, 0)], at(0), at(60))).toBeNull();
  });

  it("median helper", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});
