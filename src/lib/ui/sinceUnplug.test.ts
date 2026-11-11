import { describe, expect, it } from "vitest";
import { osloMidnightsBetween, sinceUnplug } from "./sinceUnplug";
import { formatPastDayAndTime } from "@/lib/datetime";

// Tuesday 10 Nov 2026, 17:00 Oslo (UTC+1)
const now = new Date("2026-11-10T16:00:00Z");
const r = (iso: string, batteryPercent: number | null, odometerKm: number | null = null) => ({
  at: new Date(iso),
  batteryPercent,
  odometerKm,
});

describe("sinceUnplug", () => {
  it("is hidden without an unplug or without a reading after it", () => {
    expect(sinceUnplug({ readings: [r("2026-11-10T10:00:00Z", 70)], lastUnplug: null, now })).toBeNull();
    expect(
      sinceUnplug({ readings: [r("2026-11-10T05:00:00Z", 80)], lastUnplug: new Date("2026-11-10T06:31:00Z"), now }),
    ).toBeNull();
  });

  it("counts battery and km from the last readings at or before the unplug", () => {
    const result = sinceUnplug({
      readings: [
        r("2026-11-10T04:00:00Z", 80, 18300),
        r("2026-11-10T11:00:00Z", 70, 18320),
        r("2026-11-10T15:41:00Z", 62, 18341),
      ],
      lastUnplug: new Date("2026-11-10T06:31:00Z"),
      now,
    });
    expect(result?.change).toBe(-18);
    expect(result?.drivenKm).toBe(41);
    expect(result?.fromIso).toBe("2026-11-10T06:31:00.000Z");
    expect(result?.points.map((p) => p.percent)).toEqual([80, 70, 62]);
    expect(result?.midnightsIso).toEqual([]);
  });

  it("leaves km out when the odometer barely moved or has no reading before the unplug", () => {
    const parked = sinceUnplug({
      readings: [r("2026-11-10T04:00:00Z", 80, 18300.2), r("2026-11-10T15:00:00Z", 79, 18300.8)],
      lastUnplug: new Date("2026-11-10T06:00:00Z"),
      now,
    });
    expect(parked?.drivenKm).toBeNull();
    const noBefore = sinceUnplug({
      readings: [r("2026-11-10T08:00:00Z", 75, 18300), r("2026-11-10T15:00:00Z", 60, 18350)],
      lastUnplug: new Date("2026-11-10T06:00:00Z"),
      now,
    });
    expect(noBefore?.drivenKm).toBeNull();
    // No reading before the unplug: the line and the change start at the first one after it.
    expect(noBefore?.change).toBe(-15);
    expect(noBefore?.fromIso).toBe("2026-11-10T08:00:00.000Z");
  });

  it("marks midnights and caps the line to the last 7 days", () => {
    const result = sinceUnplug({
      readings: [
        r("2026-10-25T10:00:00Z", 90),
        r("2026-11-02T10:00:00Z", 70),
        r("2026-11-08T10:00:00Z", 55),
        r("2026-11-10T10:00:00Z", 50),
      ],
      lastUnplug: new Date("2026-10-26T08:00:00Z"),
      now,
    });
    expect(result?.change).toBe(-40); // still since the unplug
    expect(result?.fromIso).toBe("2026-11-03T10:00:00.000Z");
    expect(result?.points[0].percent).toBe(70);
    expect(result?.midnightsIso).toHaveLength(7);
    expect(result?.midnightsIso[0]).toBe("2026-11-03T23:00:00.000Z");
  });
});

describe("osloMidnightsBetween", () => {
  it("follows the Oslo clock", () => {
    expect(osloMidnightsBetween(new Date("2026-11-09T12:00:00Z"), new Date("2026-11-10T12:00:00Z")).map((d) => d.toISOString())).toEqual([
      "2026-11-09T23:00:00.000Z",
    ]);
  });
});

describe("formatPastDayAndTime", () => {
  it("uses a day word, a weekday within 6 days, else a date", () => {
    expect(formatPastDayAndTime(new Date("2026-11-10T06:31:00Z"), now)).toBe("i dag 07:31");
    expect(formatPastDayAndTime(new Date("2026-11-09T17:40:00Z"), now)).toBe("i går 18:40");
    expect(formatPastDayAndTime(new Date("2026-11-09T15:40:00Z"), now)).toBe("i går 16:40");
    expect(formatPastDayAndTime(new Date("2026-11-04T15:40:00Z"), now)).toMatch(/^ons\.? 16:40$/);
    expect(formatPastDayAndTime(new Date("2026-11-02T15:40:00Z"), now)).toMatch(/2\. nov/);
  });
});
