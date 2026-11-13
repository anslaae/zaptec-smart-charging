// What a charge cost: energy (Norgespris, kr/kWh) plus an estimate of the
// grid tariff's energy part (nettleie energiledd), all incl. VAT. There is no
// official nationwide nettleie API (see HANDOVER.md), so the rates come from
// the household's grid company price list, entered in Innstillinger.
//
// Most Norwegian grid companies (Elvia included) charge a lower energiledd at
// night (22-06), at weekends and on public holidays; that's the split used here. The monthly capacity charge
// (kapasitetsledd) isn't per kWh and isn't included. Pure, unit tested.

import { HOUSEHOLD_TIME_ZONE, zonedDateKey } from "@/lib/datetime";
import { isNorwegianHoliday } from "@/lib/holidays";

export interface Prices {
  /** kr/kWh incl. VAT */
  energyNokPerKwh: number;
  /** Nettleie energiledd kr/kWh incl. VAT and fees, weekdays 06-22; null = not included */
  gridDayNokPerKwh: number | null;
  /** Nettleie energiledd at night (22-06) and weekends; null = not included */
  gridNightNokPerKwh: number | null;
}

export interface Cost {
  energyNok: number;
  /** null when no grid rates are set */
  gridNok: number | null;
  totalNok: number;
}

export const NIGHT_START_HOUR = 22;
export const NIGHT_END_HOUR = 6;
const SLICE_MS = 5 * 60_000;

const weekdayHour = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
  timeZone: HOUSEHOLD_TIME_ZONE,
});

/** Weekend or public holiday on the Oslo calendar (Elvia's low rate all day; Smart lading's weekend ready-by). */
export function isWeekendOrHoliday(date: Date): boolean {
  const parts = Object.fromEntries(weekdayHour.formatToParts(date).map((p) => [p.type, p.value]));
  return parts.weekday === "Sat" || parts.weekday === "Sun" || isNorwegianHoliday(zonedDateKey(date, HOUSEHOLD_TIME_ZONE));
}

/** Night/weekend/holiday rate applies at this moment (Oslo wall clock). */
export function isNightOrWeekend(date: Date): boolean {
  if (isWeekendOrHoliday(date)) return true;
  const hour = Number(Object.fromEntries(weekdayHour.formatToParts(date).map((p) => [p.type, p.value])).hour);
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

/**
 * kr/kWh at a moment: energy price + the grid energy charge for that hour
 * (the planner's TariffPriceSource, HANDOFF §6b). Without grid rates it's
 * the energy price alone.
 */
export function priceAt(date: Date, prices: Prices): number {
  if (prices.gridDayNokPerKwh == null || prices.gridNightNokPerKwh == null) return prices.energyNokPerKwh;
  return prices.energyNokPerKwh + (isNightOrWeekend(date) ? prices.gridNightNokPerKwh : prices.gridDayNokPerKwh);
}

/**
 * Share of [start, end] that falls in the night/weekend rate, assuming the
 * energy was drawn evenly over the session. A session with no known end
 * counts at its start time.
 */
export function nightShare(start: Date, end: Date | null): number {
  if (!end || end.getTime() <= start.getTime()) return isNightOrWeekend(start) ? 1 : 0;
  let night = 0;
  let total = 0;
  for (let t = start.getTime(); t < end.getTime(); t += SLICE_MS) {
    const width = Math.min(SLICE_MS, end.getTime() - t);
    total += width;
    if (isNightOrWeekend(new Date(t + width / 2))) night += width;
  }
  return total > 0 ? night / total : 0;
}

/** kWh drawn in one clock hour (from the charger's hourly meter readings, D72). */
export interface HourlyKwh {
  hourStart: Date;
  kwh: number;
}

/**
 * Night/weekend share of the energy itself, from hourly meter readings: each
 * hour's kWh at that hour's rate. The rate windows start on whole hours, so
 * this is exact. Null when the hours carry no energy.
 */
export function nightShareOfEnergy(hours: HourlyKwh[]): number | null {
  const total = hours.reduce((sum, h) => sum + h.kwh, 0);
  if (!(total > 0)) return null;
  const night = hours.reduce((sum, h) => sum + (isNightOrWeekend(new Date(h.hourStart.getTime() + 30 * 60_000)) ? h.kwh : 0), 0);
  return night / total;
}

/**
 * What a session cost. With `hourly` (the charger's meter readings for the
 * session's window, D72) the grid rate follows when the energy was actually
 * drawn; without it the energy is taken as spread evenly over the session.
 * Either way the total kWh is the session's own figure.
 */
export function sessionCost(
  kwh: number,
  start: Date,
  end: Date | null,
  prices: Prices,
  hourly?: HourlyKwh[] | null,
): Cost {
  const energyNok = kwh * prices.energyNokPerKwh;
  if (prices.gridDayNokPerKwh == null || prices.gridNightNokPerKwh == null) {
    return { energyNok, gridNok: null, totalNok: energyNok };
  }
  const share = (hourly ? nightShareOfEnergy(hourly) : null) ?? nightShare(start, end);
  const gridNok = kwh * (share * prices.gridNightNokPerKwh + (1 - share) * prices.gridDayNokPerKwh);
  return { energyNok, gridNok, totalNok: energyNok + gridNok };
}

export const hasGridTariff = (prices: Prices) =>
  prices.gridDayNokPerKwh != null && prices.gridNightNokPerKwh != null;
