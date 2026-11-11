import { describe, expect, it } from "vitest";
import { isNightOrWeekend, nightShare, sessionCost, type Prices } from "./pricing";

// Tuesday 10 Nov 2026; Oslo is UTC+1
const at = (iso: string) => new Date(iso);
const prices: Prices = { energyNokPerKwh: 0.5, gridDayNokPerKwh: 0.4, gridNightNokPerKwh: 0.3 };

describe("night/weekend rate", () => {
  it("uses 22-06 Oslo time on weekdays and all weekend", () => {
    expect(isNightOrWeekend(at("2026-11-10T20:59:00Z"))).toBe(false); // 21:59
    expect(isNightOrWeekend(at("2026-11-10T21:00:00Z"))).toBe(true); // 22:00
    expect(isNightOrWeekend(at("2026-11-11T04:59:00Z"))).toBe(true); // 05:59
    expect(isNightOrWeekend(at("2026-11-11T05:00:00Z"))).toBe(false); // 06:00
    expect(isNightOrWeekend(at("2026-11-14T12:00:00Z"))).toBe(true); // Saturday noon
  });

  it("splits a session across the boundary by time", () => {
    // 21:00-23:00 Oslo: half day, half night
    expect(nightShare(at("2026-11-10T20:00:00Z"), at("2026-11-10T22:00:00Z"))).toBeCloseTo(0.5, 5);
    expect(nightShare(at("2026-11-10T12:00:00Z"), null)).toBe(0);
  });
});

describe("sessionCost", () => {
  it("adds the grid energy rate when it's set", () => {
    const cost = sessionCost(10, at("2026-11-10T20:00:00Z"), at("2026-11-10T22:00:00Z"), prices);
    expect(cost.energyNok).toBeCloseTo(5);
    expect(cost.gridNok).toBeCloseTo(3.5); // 5 kWh × 0,40 + 5 kWh × 0,30
    expect(cost.totalNok).toBeCloseTo(8.5);
  });

  it("is energy only without grid rates", () => {
    const cost = sessionCost(10, at("2026-11-10T20:00:00Z"), null, { ...prices, gridDayNokPerKwh: null });
    expect(cost).toEqual({ energyNok: 5, gridNok: null, totalNok: 5 });
  });
});
