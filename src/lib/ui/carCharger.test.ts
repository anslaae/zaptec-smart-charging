import { describe, expect, it } from "vitest";
import { activePowerSource, carConnection, circuitLimit, powerSpread } from "./carCharger";
import { smartPreview } from "./smartPreview";

describe("activePowerSource", () => {
  it("follows estimateChargingPlan's order", () => {
    expect(activePowerSource({ instantPowerWatts: 7100, maxPowerKw: 11 }, 7.1)).toBe("observed");
    expect(activePowerSource({ instantPowerWatts: 0, maxPowerKw: 11 }, 7.1)).toBe("learned");
    expect(activePowerSource({ instantPowerWatts: null, maxPowerKw: 11 }, null)).toBe("circuit");
    expect(activePowerSource({ instantPowerWatts: null, maxPowerKw: null }, null)).toBe("default");
    expect(activePowerSource(null, null)).toBe("default");
  });
});

describe("circuitLimit", () => {
  it("counts the MaxPhases bits and works back to amps", () => {
    expect(circuitLimit({ maxPowerKw: 11.04, rawObservations: { "520": "7" } })).toEqual({ amps: 16, phases: 3 });
    expect(circuitLimit({ maxPowerKw: 7.36, rawObservations: { "520": "1" } })).toEqual({ amps: 32, phases: 1 });
  });
  it("is null when unknown", () => {
    expect(circuitLimit({ maxPowerKw: null, rawObservations: { "520": "7" } })).toBeNull();
    expect(circuitLimit({ maxPowerKw: 11, rawObservations: null })).toBeNull();
    expect(circuitLimit(null)).toBeNull();
  });
});

describe("powerSpread", () => {
  it("min, max and the median (odd and even counts)", () => {
    expect(powerSpread([7.4, 6.8, 7.1])).toEqual({ min: 6.8, max: 7.4, median: 7.1 });
    expect(powerSpread([6, 8, 7, 9])).toEqual({ min: 6, max: 9, median: 7.5 });
    expect(powerSpread([])).toBeNull();
  });
});

describe("carConnection", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 10, 20, h));
  it("connected since the latest plug-in", () => {
    expect(carConnection([{ type: "unplugged", at: at(8) }, { type: "plugged_in", at: at(18) }])).toEqual({
      connected: true,
      pluggedInAt: at(18),
      unpluggedAt: null,
    });
  });
  it("unplugged, with the plug-in before it", () => {
    expect(
      carConnection([
        { type: "plugged_in", at: at(2) },
        { type: "unplugged", at: at(18) },
        { type: "plugged_in", at: at(10) },
      ]),
    ).toEqual({ connected: false, pluggedInAt: at(10), unpluggedAt: at(18) });
  });
  it("nothing known", () => {
    expect(carConnection([])).toEqual({ connected: false, pluggedInAt: null, unpluggedAt: null });
  });
});

describe("smartPreview", () => {
  const prices = { energyNokPerKwh: 0.5, gridDayNokPerKwh: 0.464, gridNightNokPerKwh: 0.314 };
  // Wednesday 18 Nov 2026, 15:00 Oslo (14:00 UTC); ready 07:30 Thursday.
  const now = new Date("2026-11-18T14:00:00Z");
  const base = {
    now,
    targetPercent: 80,
    readyByWeekday: "07:30",
    readyByWeekend: "10:00",
    capacityKwh: 46,
    learnedPowerKw: 7,
    maxPowerKw: 11,
    prices,
  };

  it("plans the cheap night window, never the evening peak", () => {
    const p = smartPreview({ ...base, socPercent: 62 });
    expect(p.readyByIso).toBe("2026-11-19T06:30:00.000Z");
    expect(p.window).not.toBeNull();
    // 8.3 kWh at 7 kW ≈ 1 h 11 min, latest night hours before 07:30 minus day rate from 06:00
    expect(Date.parse(p.window!.startIso)).toBeGreaterThanOrEqual(Date.parse("2026-11-18T21:00:00Z"));
    expect(Date.parse(p.window!.endIso)).toBeLessThanOrEqual(Date.parse("2026-11-19T06:30:00Z"));
    expect(p.window!.costNok).toBeGreaterThan(0);
  });

  it("no window when already at the target", () => {
    expect(smartPreview({ ...base, socPercent: 85 }).window).toBeNull();
  });
});
