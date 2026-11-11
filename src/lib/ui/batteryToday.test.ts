import { describe, expect, it } from "vitest";
import { batteryToday, lastMorning } from "./batteryToday";

// Tuesday 10 Nov 2026, 17:00 Oslo (UTC+1)
const now = new Date("2026-11-10T16:00:00Z");
const r = (iso: string, percent: number) => ({ at: new Date(iso), percent });

describe("lastMorning", () => {
  it("is today's 06:00 Oslo, or yesterday's before 06:00", () => {
    expect(lastMorning(now).toISOString()).toBe("2026-11-10T05:00:00.000Z");
    expect(lastMorning(new Date("2026-11-10T03:00:00Z")).toISOString()).toBe("2026-11-09T05:00:00.000Z");
  });
});

describe("batteryToday", () => {
  it("covers since 06:00, marks the unplug and the change since it", () => {
    const result = batteryToday({
      readings: [r("2026-11-10T04:00:00Z", 85), r("2026-11-10T06:31:00Z", 80), r("2026-11-10T11:00:00Z", 70), r("2026-11-10T15:41:00Z", 62)],
      lastUnplug: new Date("2026-11-10T06:31:00Z"),
      now,
    });
    expect(result?.points.map((p) => p.percent)).toEqual([80, 70, 62]);
    expect(result?.change).toBe(-18);
    expect(result?.sinceIso).toBe("2026-11-10T06:31:00.000Z");
    expect(result?.unpluggedAtIso).toBe("2026-11-10T06:31:00.000Z");
  });

  it("reaches back to an earlier unplug", () => {
    const result = batteryToday({
      readings: [r("2026-11-10T00:00:00Z", 90), r("2026-11-10T12:00:00Z", 75)],
      lastUnplug: new Date("2026-11-09T22:00:00Z"),
      now,
    });
    expect(result?.fromIso).toBe("2026-11-09T22:00:00.000Z");
    expect(result?.change).toBe(-15);
  });

  it("counts from the first reading when the unplug came after the last report", () => {
    const result = batteryToday({
      readings: [r("2026-11-10T06:00:00Z", 80), r("2026-11-10T11:00:00Z", 62)],
      lastUnplug: new Date("2026-11-10T15:30:00Z"),
      now,
    });
    expect(result?.change).toBe(-18);
    expect(result?.sinceIso).toBe("2026-11-10T06:00:00.000Z");
    expect(result?.unpluggedAtIso).toBe("2026-11-10T15:30:00.000Z");
  });

  it("uses the reading just before the unplug as the baseline", () => {
    const result = batteryToday({
      readings: [r("2026-11-10T05:30:00Z", 60), r("2026-11-10T06:20:00Z", 90), r("2026-11-10T12:00:00Z", 75)],
      lastUnplug: new Date("2026-11-10T06:30:00Z"),
      now,
    });
    expect(result?.change).toBe(-15); // 90 at the unplug → 75, not 60 → 75
  });

  it("is hidden with fewer than two readings", () => {
    expect(batteryToday({ readings: [r("2026-11-10T12:00:00Z", 70)], lastUnplug: null, now })).toBeNull();
  });
});
