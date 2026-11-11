import { HOUSEHOLD_TIME_ZONE, zonedDateKey, zonedDateTimeToUtc } from "@/lib/datetime";

// "Batteri i dag" on Hjem in noCar (HANDOFF §3): the car's battery readings
// since 06:00 today, or since the last unplug if that was earlier, with the
// unplug marked and the change since then. Hidden with fewer than two
// readings. Pure, unit tested.

export interface BatteryToday {
  points: { at: string; percent: number }[];
  /** Window start (ISO), for the x axis. */
  fromIso: string;
  /** The unplug, when it falls inside the window. */
  unpluggedAtIso: string | null;
  /** Last reading minus the first, in percentage points. */
  change: number;
  /** "siden HH:MM": the unplug if known, else the first reading. */
  sinceIso: string;
}

const MORNING_HOUR = 6;
/** Never reach back further than this, even after a long time unplugged. */
const MAX_WINDOW_MS = 36 * 3_600_000;

/** The most recent 06:00 on the Oslo clock at or before `now`. */
export function lastMorning(now: Date): Date {
  const today = zonedDateKey(now, HOUSEHOLD_TIME_ZONE);
  const at = zonedDateTimeToUtc(`${today}T0${MORNING_HOUR}:00`, HOUSEHOLD_TIME_ZONE);
  if (at.getTime() <= now.getTime()) return at;
  const [y, m, d] = today.split("-").map(Number);
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  return zonedDateTimeToUtc(`${yesterday}T0${MORNING_HOUR}:00`, HOUSEHOLD_TIME_ZONE);
}

export function batteryToday(input: {
  readings: { at: Date; percent: number }[];
  lastUnplug: Date | null;
  now: Date;
}): BatteryToday | null {
  const { now } = input;
  const morning = lastMorning(now);
  let from = input.lastUnplug && input.lastUnplug < morning ? input.lastUnplug : morning;
  if (now.getTime() - from.getTime() > MAX_WINDOW_MS) from = new Date(now.getTime() - MAX_WINDOW_MS);

  const points = input.readings
    .filter((r) => r.at >= from && r.at <= now)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (points.length < 2) return null;

  const unplugged = input.lastUnplug && input.lastUnplug >= from ? input.lastUnplug : null;
  const last = points[points.length - 1];
  // "−18 % siden 07:31" counts from the unplug only when the car has reported
  // since then; the baseline is the last reading at or before the unplug.
  // Otherwise it's simply the change since the first reading in the window.
  const countFromUnplug = unplugged != null && last.at > unplugged;
  const base = countFromUnplug ? ([...points].reverse().find((p) => p.at <= unplugged) ?? points[0]) : points[0];
  return {
    points: points.map((p) => ({ at: p.at.toISOString(), percent: Math.round(p.percent) })),
    fromIso: from.toISOString(),
    unpluggedAtIso: unplugged?.toISOString() ?? null,
    change: Math.round(last.percent) - Math.round(base.percent),
    sinceIso: (countFromUnplug ? unplugged : base.at).toISOString(),
  };
}
