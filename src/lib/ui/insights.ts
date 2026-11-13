import { HOUSEHOLD_TIME_ZONE, zonedDateKey } from "@/lib/datetime";
import type { SessionRecord } from "./history";

// Innsikt (design/redesign/HANDOFF.md §5): one month at a time. Energy per
// day and per person, plus a comparison with the same days of the previous
// month. Automatic sessions are counted in the totals (the energy was used)
// but belong to nobody; guest sessions get their own row. Pure.

export interface MonthInsights {
  month: string; // "2026-11"
  /** Days covered: up to today for the current month, the whole month otherwise. */
  days: number;
  totalKwh: number;
  totalCostNok: number;
  /** Nettleie part of totalCostNok; null when no grid rates are set. */
  gridNok: number | null;
  /** % change vs the same days last month, null when last month had nothing. */
  changePercent: number | null;
  perDay: number[];
  perPerson: { userId: string; kwh: number; costNok: number }[];
  guestKwh: number;
  guestCostNok: number;
  automaticKwh: number;
  automaticCostNok: number;
  /** D70: sessions imported from Zaptec -- counted in the totals, for no person. */
  importedKwh: number;
  importedCostNok: number;
  /** Smart lading (UC16): household energy, nobody's share -- its own row. */
  smartKwh: number;
  smartCostNok: number;
}

export function monthKeyOf(date: Date): string {
  return zonedDateKey(date, HOUSEHOLD_TIME_ZONE).slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const dayOfMonth = (date: Date) => Number(zonedDateKey(date, HOUSEHOLD_TIME_ZONE).slice(8, 10));

export function monthInsights(records: SessionRecord[], month: string, now: Date): MonthInsights {
  const current = monthKeyOf(now);
  const days = month === current ? dayOfMonth(now) : daysInMonth(month);
  const previous = shiftMonth(month, -1);

  const perDay = Array.from({ length: days }, () => 0);
  const people = new Map<string, { kwh: number; costNok: number }>();
  let guestKwh = 0;
  let guestCostNok = 0;
  let automaticKwh = 0;
  let automaticCostNok = 0;
  let importedKwh = 0;
  let importedCostNok = 0;
  let smartKwh = 0;
  let smartCostNok = 0;
  let totalCostNok = 0;
  let gridNok: number | null = null;
  let previousKwh = 0;

  for (const record of records) {
    const kwh = record.kwh ?? 0;
    if (kwh <= 0) continue;
    const key = monthKeyOf(record.startedAt);
    const day = dayOfMonth(record.startedAt);
    if (key === previous && day <= days) previousKwh += kwh;
    if (key !== month || day > days) continue;
    perDay[day - 1] += kwh;
    const cost = record.costNok ?? 0;
    totalCostNok += cost;
    if (record.gridNok != null) gridNok = (gridNok ?? 0) + record.gridNok;
    if (record.tag === "guest") {
      guestKwh += kwh;
      guestCostNok += cost;
    } else if (record.tag === "smart") {
      smartKwh += kwh;
      smartCostNok += cost;
    } else if (record.tag === "automatic") {
      automaticKwh += kwh;
      automaticCostNok += cost;
    } else if (record.tag === "imported") {
      importedKwh += kwh;
      importedCostNok += cost;
    } else if (record.userId) {
      const p = people.get(record.userId) ?? { kwh: 0, costNok: 0 };
      people.set(record.userId, { kwh: p.kwh + kwh, costNok: p.costNok + cost });
    }
  }

  const totalKwh = perDay.reduce((sum, kwh) => sum + kwh, 0);
  return {
    month,
    days,
    totalKwh,
    totalCostNok,
    gridNok,
    changePercent: previousKwh > 0 ? Math.round(((totalKwh - previousKwh) / previousKwh) * 100) : null,
    perDay,
    perPerson: [...people.entries()]
      .map(([userId, p]) => ({ userId, kwh: p.kwh, costNok: p.costNok }))
      .sort((a, b) => b.kwh - a.kwh),
    guestKwh,
    guestCostNok,
    automaticKwh,
    automaticCostNok,
    importedKwh,
    importedCostNok,
    smartKwh,
    smartCostNok,
  };
}

// Innsikt year view (HANDOFF §6d): built from the month results so the two
// views always agree -- the year total is the sum of its months. Pure.

export interface YearInsights {
  year: number;
  /** Jan..Dec; null for months after the current one. */
  months: (MonthInsights | null)[];
  /** 1-12: the current month in the current year (unfinished), else null. */
  partialMonth: number | null;
  /** Last month counted (12 for a past year). */
  lastMonth: number;
  totalKwh: number;
  totalCostNok: number;
  gridNok: number | null;
  perPerson: { userId: string; kwh: number; costNok: number }[];
  guestKwh: number;
  guestCostNok: number;
  automaticKwh: number;
  automaticCostNok: number;
  importedKwh: number;
  importedCostNok: number;
  smartKwh: number;
  smartCostNok: number;
  /** % change vs the same period of the previous year; null when that period had nothing. */
  changePercent: number | null;
}

export const yearOf = (now: Date) => Number(monthKeyOf(now).slice(0, 4));
const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

export function yearInsights(records: SessionRecord[], year: number, now: Date): YearInsights {
  const current = monthKeyOf(now);
  const currentYear = Number(current.slice(0, 4));
  const lastMonth = year === currentYear ? Number(current.slice(5, 7)) : 12;
  const months = Array.from({ length: 12 }, (_, i) =>
    i < lastMonth ? monthInsights(records, monthKey(year, i + 1), now) : null,
  );
  const counted = months.filter((m): m is MonthInsights => m != null);
  const sum = (pick: (m: MonthInsights) => number) => counted.reduce((s, m) => s + pick(m), 0);

  const people = new Map<string, { kwh: number; costNok: number }>();
  for (const m of counted) {
    for (const p of m.perPerson) {
      const q = people.get(p.userId) ?? { kwh: 0, costNok: 0 };
      people.set(p.userId, { kwh: q.kwh + p.kwh, costNok: q.costNok + p.costNok });
    }
  }
  const grids = counted.map((m) => m.gridNok).filter((g): g is number => g != null);

  // Same period last year: whole months before the last one, then the last
  // month up to the same day (the whole month for a past year).
  let previousKwh = 0;
  for (let i = 1; i <= lastMonth; i++) {
    const prev = monthInsights(records, monthKey(year - 1, i), now);
    const days = i === lastMonth ? months[i - 1]!.days : prev.perDay.length;
    previousKwh += prev.perDay.slice(0, days).reduce((s, kwh) => s + kwh, 0);
  }

  const totalKwh = sum((m) => m.totalKwh);
  return {
    year,
    months,
    partialMonth: year === currentYear ? lastMonth : null,
    lastMonth,
    totalKwh,
    totalCostNok: sum((m) => m.totalCostNok),
    gridNok: grids.length > 0 ? grids.reduce((s, g) => s + g, 0) : null,
    perPerson: [...people.entries()]
      .map(([userId, p]) => ({ userId, kwh: p.kwh, costNok: p.costNok }))
      .sort((a, b) => b.kwh - a.kwh),
    guestKwh: sum((m) => m.guestKwh),
    guestCostNok: sum((m) => m.guestCostNok),
    automaticKwh: sum((m) => m.automaticKwh),
    automaticCostNok: sum((m) => m.automaticCostNok),
    importedKwh: sum((m) => m.importedKwh),
    importedCostNok: sum((m) => m.importedCostNok),
    smartKwh: sum((m) => m.smartKwh),
    smartCostNok: sum((m) => m.smartCostNok),
    changePercent: previousKwh > 0 ? Math.round(((totalKwh - previousKwh) / previousKwh) * 100) : null,
  };
}
