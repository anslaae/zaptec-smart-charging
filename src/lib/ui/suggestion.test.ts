import { describe, expect, it } from "vitest";
import { buildSuggestion } from "./suggestion";

describe("buildSuggestion", () => {
  it("reuses the target % and computes kWh from the battery now", () => {
    expect(
      buildSuggestion({ lastPlan: { targetPercent: 80, targetKwh: 15.6 }, batteryPercent: 46.4, capacityKwh: 46 }),
    ).toEqual({ targetKwh: 15.6, targetPercent: 80, startPercent: 46 });
    expect(
      buildSuggestion({ lastPlan: { targetPercent: 80, targetKwh: 15.6 }, batteryPercent: 60, capacityKwh: 46 }),
    ).toEqual({ targetKwh: 9.2, targetPercent: 80, startPercent: 60 });
  });

  it("offers nothing when the battery is already at the target", () => {
    expect(buildSuggestion({ lastPlan: { targetPercent: 80, targetKwh: 15.6 }, batteryPercent: 80, capacityKwh: 46 })).toBeNull();
  });

  it("falls back to kWh for old plans or an unknown battery", () => {
    expect(buildSuggestion({ lastPlan: { targetPercent: null, targetKwh: 13.8 }, batteryPercent: 50, capacityKwh: 46 })).toEqual({
      targetKwh: 13.8,
      targetPercent: null,
      startPercent: null,
    });
    expect(buildSuggestion({ lastPlan: { targetPercent: 80, targetKwh: 13.8 }, batteryPercent: null, capacityKwh: 46 })?.targetKwh).toBe(13.8);
  });
});
