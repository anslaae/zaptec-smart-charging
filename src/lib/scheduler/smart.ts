import { HOUSEHOLD_TIME_ZONE, zonedDateKey, zonedDateTimeToUtc } from "@/lib/datetime";
import { isWeekendOrHoliday } from "@/lib/pricing";

// Smart lading (UC16, design/redesign/HANDOFF.md §6b): charge to the target %
// by the ready-by time, as cheaply as possible. Pure and unit tested.
//
//   1. needed kWh = (target − SoC) × capacity; hours = kWh ÷ kW
//   2. slots from now to readyBy, split on the hour; price = priceFn(slot)
//   3. leave out the evening peak 16–21 unless it's needed to reach the target
//   4. cheapest first; on ties the latest, so it finishes close to the deadline
//   5. not enough time: use every slot and flag `late`
// Prices come from a PriceFn so a spot-price source can replace the tariff later.

export type PriceFn = (at: Date) => number;

export interface SmartBlock {
  start: string;
  end: string;
}

export interface SmartPlan {
  neededKwh: number;
  powerKw: number;
  blocks: SmartBlock[];
  late: boolean;
  /** Estimated cost of the planned blocks. */
  costNok: number;
  /** What charging straight away would have cost, for "sparer ca. …". */
  nowCostNok: number;
}

export const PEAK_START_HOUR = 16;
export const PEAK_END_HOUR = 21;

const HOUR_MS = 3_600_000;

interface Slot {
  start: number;
  end: number;
  price: number;
  peak: boolean;
}

const osloHourOf = (ms: number) =>
  Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: HOUSEHOLD_TIME_ZONE }).format(
      new Date(ms),
    ),
  );

function buildSlots(now: Date, readyBy: Date, priceFn: PriceFn): Slot[] {
  const slots: Slot[] = [];
  let t = now.getTime();
  while (t < readyBy.getTime()) {
    const nextHour = Math.floor(t / HOUR_MS) * HOUR_MS + HOUR_MS; // Oslo offsets are whole hours
    const end = Math.min(nextHour, readyBy.getTime());
    const hour = osloHourOf(t);
    slots.push({ start: t, end, price: priceFn(new Date(t)), peak: hour >= PEAK_START_HOUR && hour < PEAK_END_HOUR });
    t = end;
  }
  return slots;
}

/** Cost of drawing `kwh` at `powerKw` through `parts` in order. */
function costOf(parts: { start: number; end: number; price: number }[], kwh: number, powerKw: number): number {
  let left = kwh;
  let cost = 0;
  for (const part of parts) {
    if (left <= 0) break;
    const take = Math.min(left, ((part.end - part.start) / HOUR_MS) * powerKw);
    cost += take * part.price;
    left -= take;
  }
  return cost;
}

export function planSmartCharge(input: {
  now: Date;
  socPercent: number;
  targetPercent: number;
  capacityKwh: number;
  powerKw: number;
  readyBy: Date;
  priceFn: PriceFn;
}): SmartPlan {
  const { now, readyBy, powerKw, priceFn } = input;
  const neededKwh = Math.max(0, Math.round(((input.targetPercent - input.socPercent) / 100) * input.capacityKwh * 10) / 10);
  const empty = { neededKwh, powerKw, blocks: [], late: false, costNok: 0, nowCostNok: 0 };
  if (neededKwh <= 0 || powerKw <= 0) return empty;

  const neededMs = (neededKwh / powerKw) * HOUR_MS;
  const slots = buildSlots(now, readyBy, priceFn);
  const nowCostNok = costOf(slots, neededKwh, powerKw);
  const available = slots.reduce((sum, s) => sum + (s.end - s.start), 0);

  let chosen: { start: number; end: number; price: number }[];
  let late = false;
  if (available <= neededMs) {
    // Not enough time even using every slot: charge throughout and say so.
    chosen = slots;
    late = available < neededMs;
  } else {
    const offPeak = slots.filter((s) => !s.peak);
    // Off-peak slots first (cheapest, latest on ties); evening-peak slots only
    // for whatever off-peak time can't cover -- never instead of an off-peak
    // slot at the same price.
    const rank = (list: Slot[]) => [...list].sort((a, b) => a.price - b.price || b.start - a.start);
    const ranked = [...rank(offPeak), ...rank(slots.filter((s) => s.peak))];
    chosen = [];
    let got = 0;
    for (const slot of ranked) {
      if (got >= neededMs) break;
      const take = Math.min(slot.end - slot.start, neededMs - got);
      // A partly used slot keeps its later part: finish close to the deadline.
      chosen.push({ start: slot.end - take, end: slot.end, price: slot.price });
      got += take;
    }
    chosen.sort((a, b) => a.start - b.start);
  }

  const blocks: SmartBlock[] = [];
  for (const part of chosen) {
    const last = blocks[blocks.length - 1];
    if (last && Date.parse(last.end) === part.start) last.end = new Date(part.end).toISOString();
    else blocks.push({ start: new Date(part.start).toISOString(), end: new Date(part.end).toISOString() });
  }

  return {
    neededKwh,
    powerKw,
    blocks,
    late,
    costNok: Math.round(costOf(chosen, neededKwh, powerKw) * 100) / 100,
    nowCostNok: Math.round(nowCostNok * 100) / 100,
  };
}

/** A 24h "HH:MM" (Smart lading ready-by settings). */
export function isHhmm(value: string): boolean {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}

/** "HH:MM" on an Oslo date ("YYYY-MM-DD") as an instant. */
function at(dateKey: string, hhmm: string): Date {
  return zonedDateTimeToUtc(`${dateKey}T${hhmm}`, HOUSEHOLD_TIME_ZONE);
}

/**
 * The next ready-by after `now`: today's if it's still ahead, else
 * tomorrow's -- each day using the weekday or the weekend/holiday time.
 */
export function nextSmartReadyBy(now: Date, weekday: string, weekend: string): Date {
  const today = zonedDateKey(now, HOUSEHOLD_TIME_ZONE);
  for (let offset = 0; offset < 3; offset++) {
    const [y, m, d] = today.split("-").map(Number);
    const key = new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
    const noon = at(key, "12:00");
    const candidate = at(key, isWeekendOrHoliday(noon) ? weekend : weekday);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return at(today, weekday); // unreachable: one of the next three days is always ahead
}

export type SmartDecision = "complete" | "charge" | "wait";

/**
 * What a smart row wants right now: done once the target energy is in;
 * otherwise charge inside a planned block, or once the last block has
 * ended without reaching the target (behind schedule -- keep going).
 */
export function decideSmart(input: {
  blocks: SmartBlock[];
  now: Date;
  deliveredKwh: number;
  targetKwh: number;
}): SmartDecision {
  if (input.deliveredKwh >= input.targetKwh) return "complete";
  const t = input.now.getTime();
  if (input.blocks.length === 0) return "charge";
  const inBlock = input.blocks.some((b) => Date.parse(b.start) <= t && t < Date.parse(b.end));
  const afterLast = t >= Date.parse(input.blocks[input.blocks.length - 1].end);
  return inBlock || afterLast ? "charge" : "wait";
}
