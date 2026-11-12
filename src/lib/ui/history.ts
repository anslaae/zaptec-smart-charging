import { HOUSEHOLD_TIME_ZONE, zonedDateKey } from "@/lib/datetime";

// Historikk "Økter" (design/redesign/HANDOFF.md §5): one record per charging
// session from the app's own data -- completed plans and every closed
// manual/preheat/guest/automatic session -- grouped by week, older months
// collapsed. Pure, so grouping and totals are unit tested.

export type SessionTag = "plan" | "smart" | "manual" | "preheat" | "guest" | "automatic";

export interface SessionRecord {
  id: string;
  tag: SessionTag;
  startedAt: Date;
  endedAt: Date | null;
  /** null when the energy wasn't recorded (sessions from before the redesign). */
  kwh: number | null;
  startPercent: number | null;
  endPercent: number | null;
  /** Who it counts for in Innsikt; null for guest/automatic or unknown. */
  userId: string | null;
  /** Guest sessions: "Hvem låner?" from the lend dialog. */
  guestName?: string | null;
  /** The car charged (design 6c); null for guest sessions, which never count for a car. */
  carId?: string | null;
  /** Energy + estimated nettleie (src/lib/pricing.ts); null without kWh. */
  costNok: number | null;
  /** The nettleie part of costNok; null when no grid rates are set. */
  gridNok: number | null;
}

export type WeekKey = "thisWeek" | "lastWeek";

/** Any list grouped the way Historikk shows it (all three tabs). */
export interface PeriodGroups<T> {
  /** This week and last week, always both (possibly empty). */
  weeks: { key: WeekKey; items: T[] }[];
  /** One group per older calendar month ("2026-10"), newest first. */
  months: { key: string; items: T[] }[];
}

export interface WeekGroup {
  kind: "week";
  key: WeekKey;
  records: SessionRecord[];
  kwh: number;
  costNok: number;
}

export interface MonthGroup {
  kind: "month";
  /** "2026-10" */
  key: string;
  records: SessionRecord[];
  kwh: number;
  costNok: number;
}

/** Monday 00:00 (Oslo calendar) of the week containing `date`, as a "YYYY-MM-DD" key. */
export function weekStartKey(date: Date): string {
  const key = zonedDateKey(date, HOUSEHOLD_TIME_ZONE);
  const [y, m, d] = key.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const weekday = (utc.getUTCDay() + 6) % 7; // Monday = 0
  utc.setUTCDate(utc.getUTCDate() - weekday);
  return utc.toISOString().slice(0, 10);
}

function shiftDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const sumKwh = (records: SessionRecord[]) => records.reduce((sum, r) => sum + (r.kwh ?? 0), 0);
const sumCost = (records: SessionRecord[]) => records.reduce((sum, r) => sum + (r.costNok ?? 0), 0);

/**
 * This week and last week as their own groups (always present, possibly
 * empty), then one group per calendar month for everything older, newest
 * first; items newest first within each group.
 */
export function groupByPeriod<T>(items: T[], dateOf: (item: T) => Date, now: Date): PeriodGroups<T> {
  const thisWeek = weekStartKey(now);
  const lastWeek = shiftDays(thisWeek, -7);
  const sorted = [...items].sort((x, y) => dateOf(y).getTime() - dateOf(x).getTime());
  const byBucket = new Map<string, T[]>();
  for (const item of sorted) {
    const date = dateOf(item);
    const week = weekStartKey(date);
    const bucket =
      week === thisWeek ? "thisWeek" : week === lastWeek ? "lastWeek" : zonedDateKey(date, HOUSEHOLD_TIME_ZONE).slice(0, 7);
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), item]);
  }
  const weeks = (["thisWeek", "lastWeek"] as const).map((key) => ({ key, items: byBucket.get(key) ?? [] }));
  const months = [...byBucket.keys()]
    .filter((key) => key !== "thisWeek" && key !== "lastWeek")
    .sort()
    .reverse()
    .map((key) => ({ key, items: byBucket.get(key)! }));
  return { weeks, months };
}

/** Økter: groupByPeriod plus each group's kWh and cost. */
export function groupSessions(records: SessionRecord[], now: Date): { weeks: WeekGroup[]; months: MonthGroup[] } {
  const { weeks, months } = groupByPeriod(records, (r) => r.startedAt, now);
  return {
    weeks: weeks.map(({ key, items }) => ({ kind: "week", key, records: items, kwh: sumKwh(items), costNok: sumCost(items) })),
    months: months.map(({ key, items }) => ({ kind: "month", key, records: items, kwh: sumKwh(items), costNok: sumCost(items) })),
  };
}

/** "oktober" for "2026-10" (Norwegian month name, lower case as in running text). */
export function monthName(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("nb-NO", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)));
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
