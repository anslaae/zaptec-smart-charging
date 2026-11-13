import { describe, expect, it } from "vitest";
import { daysInMonth, monthInsights, shiftMonth, yearInsights } from "./insights";
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

describe("yearInsights (§6d)", () => {
  const records = [
    rec("2026-01-15T03:00:00Z", 20, "plan", "roger"),
    rec("2026-03-02T03:00:00Z", 10, "manual", "astrid"),
    rec("2026-06-06T13:00:00Z", 8, "guest", "roger"),
    rec("2026-09-07T17:00:00Z", 4, "smart", null),
    rec("2026-11-03T03:00:00Z", 12, "plan", "astrid"),
    rec("2025-02-10T03:00:00Z", 30, "plan", "roger"), // same period last year
    rec("2025-11-08T03:00:00Z", 6, "plan", "roger"), // inside 1–10 Nov 2025
    rec("2025-11-20T03:00:00Z", 100, "plan", "roger"), // after the same day: outside
    rec("2025-12-05T03:00:00Z", 50, "plan", "roger"), // outside
  ];

  it("is the sum of its months, with future months empty", () => {
    const y = yearInsights(records, 2026, now);
    expect(y.lastMonth).toBe(11);
    expect(y.partialMonth).toBe(11);
    expect(y.months[11]).toBeNull();
    const months = y.months.filter((m) => m != null);
    expect(months).toHaveLength(11);
    expect(y.totalKwh).toBe(54);
    expect(y.totalKwh).toBe(months.reduce((s, m) => s + m.totalKwh, 0));
    expect(y.totalCostNok).toBe(months.reduce((s, m) => s + m.totalCostNok, 0));
    expect(y.perPerson).toEqual([
      { userId: "astrid", kwh: 22, costNok: 22 },
      { userId: "roger", kwh: 20, costNok: 20 },
    ]);
    expect(y.guestKwh).toBe(8);
    expect(y.smartKwh).toBe(4);
  });

  it("compares with the same period last year, up to the same day", () => {
    // 2025-01-01..2025-11-10 = 30 + 6 = 36 kWh; 54 vs 36 = +50 %
    expect(yearInsights(records, 2026, now).changePercent).toBe(50);
  });

  it("compares a past year with the whole previous year, and hides it without data", () => {
    const y = yearInsights(records, 2025, now);
    expect(y.lastMonth).toBe(12);
    expect(y.partialMonth).toBeNull();
    expect(y.totalKwh).toBe(186);
    expect(y.changePercent).toBeNull(); // nothing in 2024
  });
});
