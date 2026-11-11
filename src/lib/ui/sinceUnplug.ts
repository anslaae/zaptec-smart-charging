import { HOUSEHOLD_TIME_ZONE, zonedDateKey, zonedDateTimeToUtc } from "@/lib/datetime";
import type { DriveReading } from "./driving";

// "Koblet fra" on Hjem in noCar (HANDOFF.md §3, design update 2026-11-12):
// what happened since the last unplug -- the battery change from the latest
// reading of any age, km driven when the odometer moved, and a sparkline of
// the battery % capped to the last 7 days with each midnight marked. Hidden
// when there is no reading after the unplug. Pure, unit tested.

export interface SinceUnplug {
  unpluggedAtIso: string;
  /** Sparkline span: from the unplug (or 7 days before the last reading) to the last reading. */
  fromIso: string;
  toIso: string;
  points: { at: string; percent: number }[];
  /** Latest reading minus the last reading at or before the unplug, in percentage points. */
  change: number;
  /** Odometer now minus at the unplug, rounded; null unless it moved ≥ 1 km with readings on both sides. */
  drivenKm: number | null;
  /** Oslo midnights inside the span (dashed lines). */
  midnightsIso: string[];
}

const SPARK_DAYS = 7;
const DAY_MS = 86_400_000;

function nextDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function osloMidnightsBetween(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  let key = nextDayKey(zonedDateKey(from, HOUSEHOLD_TIME_ZONE));
  for (;;) {
    const at = zonedDateTimeToUtc(`${key}T00:00`, HOUSEHOLD_TIME_ZONE);
    if (at.getTime() >= to.getTime()) return out;
    if (at.getTime() > from.getTime()) out.push(at);
    key = nextDayKey(key);
  }
}

export function sinceUnplug(input: { readings: DriveReading[]; lastUnplug: Date | null; now: Date }): SinceUnplug | null {
  const { lastUnplug: unplug, now } = input;
  if (!unplug) return null;
  const sorted = [...input.readings].filter((r) => r.at <= now).sort((a, b) => a.at.getTime() - b.at.getTime());
  const battery = sorted.filter((r) => r.batteryPercent != null);
  const after = battery.filter((r) => r.at > unplug);
  if (after.length === 0) return null;

  const last = after.at(-1)!;
  const atUnplug = battery.findLast((r) => r.at <= unplug);
  const base = atUnplug ?? after[0];

  // The line starts at the unplug with the battery as it was then; after a long
  // time unplugged only the last 7 days are drawn.
  let from = new Date(Math.max(unplug.getTime(), last.at.getTime() - SPARK_DAYS * DAY_MS));
  let startPercent = battery.findLast((r) => r.at <= from)?.batteryPercent;
  if (startPercent == null) {
    from = after[0].at;
    startPercent = after[0].batteryPercent!;
  }
  const points = [
    { at: from, percent: startPercent },
    ...battery.filter((r) => r.at > from).map((r) => ({ at: r.at, percent: r.batteryPercent! })),
  ];

  const odometer = sorted.filter((r) => r.odometerKm != null);
  const odoBefore = odometer.findLast((r) => r.at <= unplug);
  const odoAfter = odometer.findLast((r) => r.at > unplug);
  const moved = odoBefore && odoAfter ? odoAfter.odometerKm! - odoBefore.odometerKm! : 0;

  return {
    unpluggedAtIso: unplug.toISOString(),
    fromIso: from.toISOString(),
    toIso: last.at.toISOString(),
    points: points.map((p) => ({ at: p.at.toISOString(), percent: Math.round(p.percent) })),
    change: Math.round(last.batteryPercent!) - Math.round(base.batteryPercent!),
    drivenKm: moved >= 1 ? Math.round(moved) : null,
    midnightsIso: osloMidnightsBetween(from, last.at).map((d) => d.toISOString()),
  };
}
