import { describe, expect, it } from "vitest";
import { daysInMonth, monthInsights, shiftMonth } from "./insights";
import type { SessionRecord } from "./history";

const rec = (iso: string, kwh: number | null, tag: SessionRecord["tag"], userId: string | null): SessionRecord => ({
  id: iso + tag,
  tag,
  startedAt: new Date(iso),
  endedAt: null,
  kwh,
  startPercent: null,
  endPercent: null,
  userId,
  costNok: kwh,
  gridNok: null,
});

const now = new Date("2026-11-10T11:00:00Z");

describe("month helpers", () => {
  it("shifts across years and counts days", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(daysInMonth("2026-02")).toBe(28);
  });
});

describe("monthInsights", () => {
  const records = [
    rec("2026-11-02T03:00:00Z", 15, "plan", "roger"),
    rec("2026-11-05T16:00:00Z", 5, "manual", "astrid"),
    rec("2026-11-06T13:00:00Z", 18, "guest", "roger"),
    rec("2026-11-07T17:00:00Z", 3, "automatic", null),
    rec("2026-11-12T03:00:00Z", 99, "plan", "roger"), // future day of a current month can't exist; ignored by days cap
    rec("2026-10-03T03:00:00Z", 30, "plan", "roger"), // inside Oct 1-10
    rec("2026-10-20T03:00:00Z", 50, "plan", "roger"), // outside the comparison window
  ];

  it("totals the current month up to today, split per person, guest and automatic", () => {
    const m = monthInsights(records, "2026-11", now);
    expect(m.days).toBe(10);
    expect(m.totalKwh).toBe(41);
    expect(m.perDay[1]).toBe(15);
    expect(m.perPerson).toEqual([
      { userId: "roger", kwh: 15, costNok: 15 },
      { userId: "astrid", kwh: 5, costNok: 5 },
    ]);
    expect(m.totalCostNok).toBe(41);
    expect(m.gridNok).toBeNull();
    expect(m.guestKwh).toBe(18);
    expect(m.automaticKwh).toBe(3);
    expect(m.changePercent).toBe(37); // 41 vs 30
  });

  it("uses the whole month for a past month", () => {
    const m = monthInsights(records, "2026-10", now);
    expect(m.days).toBe(31);
    expect(m.totalKwh).toBe(80);
    expect(m.changePercent).toBeNull();
  });
});
