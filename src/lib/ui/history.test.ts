import { describe, expect, it } from "vitest";
import { groupByPeriod, groupSessions, monthName, weekStartKey, type SessionRecord } from "./history";

const rec = (id: string, iso: string, kwh: number | null, tag: SessionRecord["tag"] = "plan"): SessionRecord => ({
  id,
  tag,
  startedAt: new Date(iso),
  endedAt: null,
  kwh,
  startPercent: null,
  endPercent: null,
  userId: null,
  costNok: kwh == null ? null : kwh * 0.5,
  gridNok: null,
});

// Tuesday 10 Nov 2026, 12:00 Oslo
const now = new Date("2026-11-10T11:00:00Z");

describe("weekStartKey", () => {
  it("uses Monday on the Oslo calendar", () => {
    expect(weekStartKey(now)).toBe("2026-11-09");
    // Sunday 23:30 Oslo is still the previous week
    expect(weekStartKey(new Date("2026-11-08T22:30:00Z"))).toBe("2026-11-02");
    // Monday 00:30 Oslo (Sunday 23:30 UTC) is the new week
    expect(weekStartKey(new Date("2026-11-08T23:30:00Z"))).toBe("2026-11-09");
  });
});

describe("groupSessions", () => {
  it("splits this week, last week and older months with totals", () => {
    const { weeks, months } = groupSessions(
      [
        rec("a", "2026-11-10T04:00:00Z", 15.6),
        rec("b", "2026-11-09T04:00:00Z", 8.4),
        rec("c", "2026-11-04T04:00:00Z", 24, "manual"),
        rec("d", "2026-10-20T04:00:00Z", 10),
        rec("e", "2026-10-02T04:00:00Z", null, "preheat"),
        rec("f", "2026-09-30T04:00:00Z", 5),
      ],
      now,
    );
    expect(weeks.map((w) => w.costNok)).toEqual([12, 12]);
    expect(weeks.map((w) => [w.key, w.records.map((r) => r.id), w.kwh])).toEqual([
      ["thisWeek", ["a", "b"], 24],
      ["lastWeek", ["c"], 24],
    ]);
    expect(months.map((m) => [m.key, m.records.map((r) => r.id), m.kwh])).toEqual([
      ["2026-10", ["d", "e"], 10],
      ["2026-09", ["f"], 5],
    ]);
  });

  it("keeps both week groups even when empty", () => {
    const { weeks, months } = groupSessions([], now);
    expect(weeks.map((w) => w.records.length)).toEqual([0, 0]);
    expect(months).toEqual([]);
  });

  it("groups any list by its own date (Planer, Aktivitet), newest first", () => {
    const items = [
      { id: "old", at: new Date("2026-10-05T10:00:00Z") },
      { id: "this1", at: new Date("2026-11-09T10:00:00Z") },
      { id: "this2", at: new Date("2026-11-10T10:00:00Z") },
      { id: "sep", at: new Date("2026-09-28T10:00:00Z") },
    ];
    const { weeks, months } = groupByPeriod(items, (i) => i.at, now);
    expect(weeks.map((w) => [w.key, w.items.map((i) => i.id)])).toEqual([
      ["thisWeek", ["this2", "this1"]],
      ["lastWeek", []],
    ]);
    expect(months.map((m) => [m.key, m.items.map((i) => i.id)])).toEqual([
      ["2026-10", ["old"]],
      ["2026-09", ["sep"]],
    ]);
  });

  it("names months in Norwegian", () => {
    expect(monthName("2026-10")).toBe("oktober");
  });
});
