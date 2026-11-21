import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { chargeSchedules, chargerStateLog, manualChargeSessions, vehicleTelemetry } from "@/lib/db/schema";
import { getStateOfCharge, stateOfChargeCarId } from "@/lib/smartcar/client";
import { defaultCarId } from "@/lib/cars";
import type { ChargerState } from "@/lib/zaptec/types";
import { planDeliveredKwh } from "@/lib/records";
import {
  BRACKET_MS,
  bracketReadings,
  deliveredAtReading,
  drawnKwhBetween,
  learnKwhPerPercent,
  readingDecision,
  type BatteryReading,
  type KwhPerPercentSample,
  type ReadingAction,
  type SocAdjust,
} from "./socTarget";

// D86, the DB side: the tick's battery reading, the learned kWh per %, and
// applying a reading to an open plan or automatic session. Nothing here sends
// a charger command -- a "complete" goes back to the caller's completion path.

type Schedule = typeof chargeSchedules.$inferSelect;
type SessionRow = typeof manualChargeSessions.$inferSelect;

/** A battery reading and the car it belongs to (M1: only the household's Smartcar car reports). */
export type CarReading = BatteryReading & { carId: string | null };

/**
 * The car's latest battery reading: the newer of Smartcar's API and the
 * newest webhook row (same rule as Hjem and resolveSocPercent), with its car.
 * Null when the car has never reported.
 */
export async function latestBatteryReading(): Promise<CarReading | null> {
  const [api, [row]] = await Promise.all([
    getStateOfCharge().catch(() => null),
    db
      .select({ percent: vehicleTelemetry.batteryPercent, at: vehicleTelemetry.batteryReportedAt, carId: vehicleTelemetry.carId })
      .from(vehicleTelemetry)
      .where(isNotNull(vehicleTelemetry.batteryPercent))
      .orderBy(desc(vehicleTelemetry.batteryReportedAt))
      .limit(1),
  ]);
  const fromRow = row?.percent != null && row.at ? { percent: row.percent, oemUpdatedAt: row.at } : null;
  if (api && (!fromRow || api.oemUpdatedAt.getTime() >= fromRow.oemUpdatedAt.getTime())) {
    return { ...api, carId: await stateOfChargeCarId().catch(() => null) };
  }
  if (!fromRow) return null;
  // Rows from before car attribution (design 6c) belong to the default car.
  return { ...fromRow, carId: row!.carId ?? (await defaultCarId()) };
}

type KwhPerPercentDetails = { kwhPerPercent: number; learned: boolean; samples: (KwhPerPercentSample & { endedAt: Date })[] };

// M2: completed plans change rarely; one lookup per ~10 min per capacity is plenty (tick and Hjem).
const CACHE_MS = 10 * 60_000;
const kppCache = new Map<number, { at: number; value: KwhPerPercentDetails }>();
/** Tests only. */
export function resetKwhPerPercentCache(): void {
  kppCache.clear();
}

/** The learned kWh per % with the samples behind it (newest first), for Innstillinger if wanted. */
export async function getKwhPerPercentDetails(capacityKwh: number): Promise<KwhPerPercentDetails> {
  const hit = kppCache.get(capacityKwh);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await loadKwhPerPercentDetails(capacityKwh);
  kppCache.set(capacityKwh, { at: Date.now(), value });
  return value;
}

const CANDIDATE_LIMIT = 30;

async function loadKwhPerPercentDetails(capacityKwh: number): Promise<KwhPerPercentDetails> {
  const nominal = capacityKwh / 100;
  try {
    const plans = await db
      .select()
      .from(chargeSchedules)
      .where(and(eq(chargeSchedules.status, "completed"), isNotNull(chargeSchedules.startedAt), isNotNull(chargeSchedules.endedAt)))
      .orderBy(desc(chargeSchedules.endedAt))
      .limit(CANDIDATE_LIMIT);
    if (plans.length === 0) return { kwhPerPercent: nominal, learned: false, samples: [] };
    const from = new Date(Math.min(...plans.map((p) => p.startedAt!.getTime())) - BRACKET_MS);
    const to = new Date(Math.max(...plans.map((p) => p.endedAt!.getTime())) + BRACKET_MS);
    const rows = await db
      .select({ percent: vehicleTelemetry.batteryPercent, at: vehicleTelemetry.batteryReportedAt })
      .from(vehicleTelemetry)
      .where(
        and(
          isNotNull(vehicleTelemetry.batteryPercent),
          gte(vehicleTelemetry.batteryReportedAt, from),
          lte(vehicleTelemetry.batteryReportedAt, to),
        ),
      )
      .orderBy(asc(vehicleTelemetry.batteryReportedAt));
    const readings: BatteryReading[] = rows.map((r) => ({ percent: r.percent!, oemUpdatedAt: r.at! }));
    const samples: (KwhPerPercentSample & { endedAt: Date })[] = [];
    for (const plan of plans) {
      const pair = bracketReadings(readings, plan.startedAt!, plan.endedAt!);
      const kwh = planDeliveredKwh(plan);
      if (!pair || kwh == null) continue;
      samples.push({ kwh, deltaPercent: pair.after.percent - pair.before.percent, endedAt: plan.endedAt! });
    }
    const kwhPerPercent = learnKwhPerPercent(samples, capacityKwh);
    return { kwhPerPercent, learned: kwhPerPercent !== nominal, samples };
  } catch (error) {
    console.warn("[scheduler] kWh per % lookup failed:", error instanceof Error ? error.message : error);
    return { kwhPerPercent: nominal, learned: false, samples: [] };
  }
}

/**
 * kWh from the wall per battery % (D86): learned from completed plans with
 * a reading on each side, else capacity/100. Use it wherever a % becomes kWh.
 */
export async function getKwhPerPercent(capacityKwh: number): Promise<number> {
  return (await getKwhPerPercentDetails(capacityKwh)).kwhPerPercent;
}

/** The "capacity" to plan with: 100 × the learned kWh per %. Drop-in for capacityKwh in % → kWh maths. */
export async function getPlanningCapacityKwh(capacityKwh: number): Promise<number> {
  return Math.round((await getKwhPerPercent(capacityKwh)) * 100 * 100) / 100;
}

/**
 * Plan kWh delivered when the reading was taken, from the measured state log
 * (H1): delivered now minus what the charger logged drawing since then. Null
 * without a log row in force at the reading -- drift is skipped then.
 */
async function deliveredAtReadingFromLog(
  chargerId: string,
  reading: BatteryReading,
  deliveredKwh: number,
  floor: number,
  now: Date,
): Promise<number | null> {
  const rows = await db
    .select({ observedAt: chargerStateLog.observedAt, operationMode: chargerStateLog.operationMode, powerKw: chargerStateLog.powerKw })
    .from(chargerStateLog)
    .where(
      and(
        eq(chargerStateLog.chargerId, chargerId),
        gte(chargerStateLog.observedAt, new Date(reading.oemUpdatedAt.getTime() - 24 * 3_600_000)),
        lte(chargerStateLog.observedAt, now),
      ),
    )
    .orderBy(asc(chargerStateLog.observedAt));
  const drawn = drawnKwhBetween(
    rows.map((r) => ({ ...r, powerKw: r.powerKw == null ? null : Number(r.powerKw) })),
    reading.oemUpdatedAt,
    now,
  );
  return deliveredAtReading({ deliveredKwh, drawnSinceKwh: drawn, floor });
}

/**
 * Applies the latest reading to an open user plan or Smart row. Returns the
 * decision; a "retarget" (user plans only) is already written to the row
 * (guarded so a closed row is never touched). `deliveredKwh` is the plan's
 * reconciled total. A reading from another car than the plan's is ignored (M1).
 */
export async function checkPlanReading(input: {
  schedule: Schedule;
  state: ChargerState;
  deliveredKwh: number;
  reading: CarReading | null;
  kwhPerPercent: number;
  now: Date;
}): Promise<ReadingAction> {
  const { schedule, now } = input;
  let reading = input.reading;
  if (reading && reading.carId !== (schedule.carId ?? (await defaultCarId()))) reading = null;
  const lastAdjust = (schedule.socAdjust as SocAdjust | null) ?? null;
  const allowRetarget = schedule.source !== "smart";
  const action = readingDecision({
    reading,
    chargingStartedAt: schedule.startedAt,
    targetPercent: schedule.targetPercent,
    startPercent: schedule.startPercent,
    deliveredKwh: input.deliveredKwh,
    deliveredAtReadingKwh:
      reading && allowRetarget && schedule.startedAt
        ? await deliveredAtReadingFromLog(schedule.chargerId, reading, input.deliveredKwh, lastAdjust?.delivered ?? 0, now)
        : null,
    targetKwh: Number(schedule.targetEnergyKwh),
    kwhPerPercent: input.kwhPerPercent,
    lastAdjust,
    allowRetarget,
    now,
  });
  if (action.kind === "retarget") {
    await db
      .update(chargeSchedules)
      .set({ targetEnergyKwh: action.targetKwh.toFixed(2), socAdjust: action.adjust, updatedAt: now })
      .where(and(eq(chargeSchedules.id, schedule.id), inArray(chargeSchedules.status, ["pending", "active"])));
    console.log(`[scheduler] plan ${schedule.id}: battery ${action.adjust.percent} % -> target ${action.targetKwh} kWh`);
  }
  return action;
}

/**
 * The same for an open automatic session ("Lad med en gang", target %
 * = settings.smartTargetPercent). Its starting % is implied by the target
 * kWh it was opened with. A "retarget" is written to the row. Only for a row
 * attributed to the reading's car (M1): a guest's or another car's never.
 */
export async function checkSessionReading(input: {
  row: SessionRow;
  state: ChargerState;
  deliveredKwh: number;
  targetPercent: number;
  reading: CarReading | null;
  kwhPerPercent: number;
  now: Date;
}): Promise<ReadingAction> {
  const { row, now, kwhPerPercent } = input;
  if (row.kind !== "automatic") return { kind: "none", why: "not automatic" };
  const reading = input.reading && row.carId != null && input.reading.carId === row.carId ? input.reading : null;
  const lastAdjust = (row.socAdjust as SocAdjust | null) ?? null;
  const targetKwh = row.targetKwh == null ? null : Number(row.targetKwh);
  const action = readingDecision({
    reading,
    chargingStartedAt: row.startedAt,
    targetPercent: input.targetPercent,
    startPercent: targetKwh != null && kwhPerPercent > 0 ? Math.round(input.targetPercent - targetKwh / kwhPerPercent) : null,
    deliveredKwh: input.deliveredKwh,
    deliveredAtReadingKwh: reading
      ? await deliveredAtReadingFromLog(row.chargerId, reading, input.deliveredKwh, lastAdjust?.delivered ?? 0, now)
      : null,
    targetKwh,
    kwhPerPercent,
    lastAdjust,
    allowRetarget: true,
    now,
  });
  if (action.kind === "retarget") {
    await db
      .update(manualChargeSessions)
      .set({ targetKwh: action.targetKwh.toFixed(2), socAdjust: action.adjust })
      .where(and(eq(manualChargeSessions.id, row.id), isNull(manualChargeSessions.endedAt)));
    console.log(`[scheduler] automatic session ${row.id}: battery ${action.adjust.percent} % -> target ${action.targetKwh} kWh`);
  }
  return action;
}
