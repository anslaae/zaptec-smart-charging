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
