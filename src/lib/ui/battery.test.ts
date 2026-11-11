import { describe, expect, it } from "vitest";
import { estimateBattery, greetingPart, kwhDeliveredSinceReading } from "./battery";

const now = new Date("2026-11-10T03:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("kwhDeliveredSinceReading", () => {
  it("counts the whole session when the reading predates it", () => {
    expect(kwhDeliveredSinceReading(minutesAgo(120), now, 6, 60 * 60)).toBe(6);
  });

  it("counts only the share after a mid-session reading", () => {
    // session started 60 min ago, reading 15 min ago -> last quarter of the energy
    expect(kwhDeliveredSinceReading(minutesAgo(15), now, 8, 60 * 60)).toBeCloseTo(2);
  });

  it("is zero without energy or a session duration", () => {
    expect(kwhDeliveredSinceReading(minutesAgo(30), now, 0, 600)).toBe(0);
    expect(kwhDeliveredSinceReading(minutesAgo(30), now, 5, null)).toBe(0);
  });
});

describe("estimateBattery", () => {
  const base = {
    capacityKwh: 46,
    now,
    charging: false,
    sessionEnergyKwh: null,
    chargeDurationSeconds: null,
    remainingPlanKwh: null,
  };

  it("has no figures without a Smartcar reading", () => {
    expect(estimateBattery({ ...base, reading: null })).toEqual({
      percent: null,
      approx: false,
      measuredAt: null,
      targetPercent: null,
    });
  });

  it("shows a fresh reading as-is, without a measured hint", () => {
    const result = estimateBattery({ ...base, reading: { percent: 52, oemUpdatedAt: minutesAgo(20) } });
    expect(result).toEqual({ percent: 52, approx: false, measuredAt: null, targetPercent: null });
  });

  it("adds a measured hint when the reading is over an hour old", () => {
    const readAt = minutesAgo(90);
    expect(estimateBattery({ ...base, reading: { percent: 52, oemUpdatedAt: readAt } }).measuredAt).toEqual(readAt);
  });

  it("estimates upward while charging and marks it approximate", () => {
    const result = estimateBattery({
      ...base,
      charging: true,
      sessionEnergyKwh: 4.6, // 10 % of 46 kWh
      chargeDurationSeconds: 40 * 60,
      reading: { percent: 40, oemUpdatedAt: minutesAgo(120) },
    });
    expect(result.percent).toBe(50);
    expect(result.approx).toBe(true);
  });

  it("places the target tick from the plan's remaining kWh", () => {
    const result = estimateBattery({
      ...base,
      remainingPlanKwh: 13.8, // 30 %
      reading: { percent: 50, oemUpdatedAt: minutesAgo(10) },
    });
    expect(result.targetPercent).toBe(80);
  });

  it("never goes above 100 %", () => {
    const result = estimateBattery({
      ...base,
      charging: true,
      sessionEnergyKwh: 20,
      chargeDurationSeconds: 3 * 3600,
      remainingPlanKwh: 10,
      reading: { percent: 90, oemUpdatedAt: minutesAgo(200) },
    });
    expect(result.percent).toBe(100);
    expect(result.targetPercent).toBe(100);
  });
});

describe("greetingPart", () => {
  it("maps Oslo hours to greeting bands", () => {
    expect(greetingPart(6)).toBe("morning");
    expect(greetingPart(10)).toBe("day");
    expect(greetingPart(15)).toBe("afternoon");
    expect(greetingPart(21)).toBe("evening");
    expect(greetingPart(2)).toBe("evening");
  });
});
