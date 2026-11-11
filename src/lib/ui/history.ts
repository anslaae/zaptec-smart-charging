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
  /** Energy + estimated nettleie (src/lib/pricing.ts); null without kWh. */
  costNok: number | null;
  /** The nettleie part of costNok; null when no grid rates are set. */
  gridNok: number | null;
}

export interface WeekGroup {
  kind: "week";
  key: "thisWeek" | "lastWeek";
  records: SessionRecord[];
  kwh: number;
  costNok: number;
  /** enforcement stops (stopped_unplanned) in the same week, for the quiet summary line */
  automaticStops: number;
}

export interface MonthGroup {
  kind: "month";
  /** "2026-10" */
  key: string;
  records: SessionRecord[];
  kwh: number;
  costNok: number;
  automaticStops: number;
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
 * empty, so the totals line has a home), then one collapsed group per
 * calendar month for everything older, newest first.
 */
export function groupSessions(
  records: SessionRecord[],
  stops: Date[],
  now: Date,
): { weeks: WeekGroup[]; months: MonthGroup[] } {
  const thisWeek = weekStartKey(now);
  const lastWeek = shiftDays(thisWeek, -7);
  const sorted = [...records].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  const bucketOf = (date: Date): string => {
    const week = weekStartKey(date);
    if (week === thisWeek) return "thisWeek";
    if (week === lastWeek) return "lastWeek";
    return zonedDateKey(date, HOUSEHOLD_TIME_ZONE).slice(0, 7);
  };

  const byBucket = new Map<string, SessionRecord[]>();
  for (const record of sorted) {
    const bucket = bucketOf(record.startedAt);
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), record]);
  }
  const stopsByBucket = new Map<string, number>();
  for (const stop of stops) {
    const bucket = bucketOf(stop);
    stopsByBucket.set(bucket, (stopsByBucket.get(bucket) ?? 0) + 1);
  }

  const weeks: WeekGroup[] = (["thisWeek", "lastWeek"] as const).map((key) => {
    const list = byBucket.get(key) ?? [];
    return { kind: "week", key, records: list, kwh: sumKwh(list), costNok: sumCost(list), automaticStops: stopsByBucket.get(key) ?? 0 };
  });
  const monthKeys = [...new Set([...byBucket.keys(), ...stopsByBucket.keys()])]
    .filter((key) => key !== "thisWeek" && key !== "lastWeek")
    .sort()
    .reverse();
  const months: MonthGroup[] = monthKeys.map((key) => {
    const list = byBucket.get(key) ?? [];
    return { kind: "month", key, records: list, kwh: sumKwh(list), costNok: sumCost(list), automaticStops: stopsByBucket.get(key) ?? 0 };
  });
  return { weeks, months };
}

/** "oktober" for "2026-10" (Norwegian month name, lower case as in running text). */
export function monthName(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("nb-NO", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)));
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
