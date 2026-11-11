import { monthKeyOf } from "./insights";

// Kjøring in Innsikt (design/redesign/HANDOFF.md §6c): km driven, consumption
// and cost per distance for one month and one car, from the Smartcar
// odometer and battery readings in vehicle_telemetry. Readings are sparse
// (hours apart) and the battery % is an integer, so these are monthly
// figures only. Pure.

export interface DriveReading {
  at: Date;
  odometerKm: number | null;
  batteryPercent: number | null;
  /** When the battery value itself was reported (it is carried forward on odometer-only rows). */
  batteryAt?: Date | null;
}

/** A charging session at home for this car (guest sessions excluded by the caller). */
export interface HomeSession {
  startedAt: Date;
  endedAt: Date | null;
}

export interface MonthDriving {
  month: string;
  /** Km driven in the month; null when the month has no odometer reading. */
  km: number | null;
  /** True when km ≥ MIN_KM and the counted battery drop ≥ MIN_SOC_DROP: show the figures below. */
  enough: boolean;
  kmPerKwh: number | null;
  kwhPerMil: number | null;
  /** kr per mil at the month's average home price; null without a price. */
  nokPerMil: number | null;
  /** Pairs where the battery rose with no home session in between ("lading et annet sted"). */
  awayCharges: number;
  /** Battery % that fell over the counted pairs. */
  socDropPercent: number;
}

export const MIN_KM = 100;
export const MIN_SOC_DROP = 5;

const overlaps = (s: HomeSession, from: Date, to: Date) =>
  s.startedAt.getTime() < to.getTime() && (s.endedAt?.getTime() ?? Infinity) > from.getTime();

/**
 * Km = last odometer reading in the month − last reading before it (or the
 * first in the month without one). Consumption comes from battery drops, not
 * home-charged kWh, because the car may charge elsewhere: a pair of
 * consecutive readings counts when the odometer went up, the battery didn't
 * rise and no home session overlaps it; its Δ% × capacity and its km both go
 * into the ratio. A pair where the battery rose without a home session is an
 * away charge -- left out and counted for the footnote.
 */
export function monthDriving(
  telemetry: DriveReading[],
  homeSessions: HomeSession[],
  month: string,
  capacityKwh: number,
  avgNokPerKwh: number | null,
): MonthDriving {
  const sorted = [...telemetry].sort((a, b) => a.at.getTime() - b.at.getTime());
  const before = sorted.filter((r) => monthKeyOf(r.at) < month);
  const inMonth = sorted.filter((r) => monthKeyOf(r.at) === month);
  // The pair across the month boundary belongs to the month (as its km do).
  const lastBefore = before.findLast((r) => r.odometerKm != null) ?? before.at(-1);
  const window = lastBefore ? [lastBefore, ...inMonth] : inMonth;

  const odoInMonth = inMonth.filter((r) => r.odometerKm != null);
  const baseline = before.findLast((r) => r.odometerKm != null) ?? odoInMonth[0];
  const km =
    odoInMonth.length > 0 && baseline
      ? Math.max(0, odoInMonth.at(-1)!.odometerKm! - baseline.odometerKm!)
      : null;

  let countedKm = 0;
  let socDrop = 0;
  let awayCharges = 0;
  for (let i = 1; i < window.length; i++) {
    const a = window[i - 1];
    const b = window[i];
    if (a.batteryPercent == null || b.batteryPercent == null) continue;
    const charged = homeSessions.some((s) => overlaps(s, a.at, b.at));
    if (b.batteryPercent > a.batteryPercent) {
      if (!charged) awayCharges++;
      continue;
    }
    if (charged || a.odometerKm == null || b.odometerKm == null) continue;
    const moved = b.odometerKm - a.odometerKm;
    if (moved <= 0) continue;
    countedKm += moved;
    socDrop += a.batteryPercent - b.batteryPercent;
  }

  const kwh = (socDrop / 100) * capacityKwh;
  const enough = km != null && km >= MIN_KM && socDrop >= MIN_SOC_DROP && countedKm > 0 && kwh > 0;
  const kwhPerMil = enough ? (kwh / countedKm) * 10 : null;
  return {
    month,
    km,
    enough,
    kmPerKwh: enough ? countedKm / kwh : null,
    kwhPerMil,
    nokPerMil: kwhPerMil != null && avgNokPerKwh != null ? kwhPerMil * avgNokPerKwh : null,
    awayCharges,
    socDropPercent: socDrop,
  };
}

/** The latest odometer reading at or before the end of `month` (the card's header). */
export function latestOdometer(telemetry: DriveReading[], month: string): { km: number; at: Date } | null {
  const last = telemetry
    .filter((r) => r.odometerKm != null && monthKeyOf(r.at) <= month)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .at(-1);
  return last ? { km: last.odometerKm!, at: last.at } : null;
}
