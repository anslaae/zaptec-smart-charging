import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { chargeSchedules, chargerStateLog, scheduleActions } from "@/lib/db/schema";
import { drawingPowerKw, median, wallClockKw } from "./powerHistory";
import type { StateLogPoint } from "./chargingSince";

// Headroom: some candidates give no sample (no drawing logged, or an old
// paused plan), so the final set of SAMPLE_LIMIT isn't thinned out.
const CANDIDATE_LIMIT = 20;
const SAMPLE_LIMIT = 10;

/** The learned real-world charge rate (see getLearnedPowerDetails). Null with no usable history. */
export async function getLearnedPowerKw(): Promise<number | null> {
  return (await getLearnedPowerDetails()).kw;
}

/** One realised-rate sample for Innstillinger → Lader's dot plot (design §6g). */
export interface LearnedPowerSample {
  kw: number;
  endedAt: Date;
}

/** The learned rate plus the samples it is the median of (newest first). */
export interface LearnedPowerDetails {
  kw: number | null;
  samples: LearnedPowerSample[];
}

/**
 * D85. Per completed plan (user or Smart), newest first, the kW the car
 * actually drew: the time-weighted median of charger_state_log's power while
 * drawing (powerHistory.ts explains the choice). A plan that started before
 * the charger's oldest state-log row (the log began ~13 Nov 2026 and keeps 30
 * days) falls back to the old wall-clock sample, and only if it was never
 * paused (paused time would understate the rate). kw = median of the
 * samples. Shared contract with the Lader page (design §6g): keep the
 * signature and the types above unchanged.
 */
export async function getLearnedPowerDetails(): Promise<LearnedPowerDetails> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = await loadLearnedPowerDetails();
  cache = { at: Date.now(), value };
  return value;
}

// M2: completed plans change rarely; the tick, Hjem and Innstillinger share
// one lookup per ~10 min (per warm instance).
const CACHE_MS = 10 * 60_000;
let cache: { at: number; value: LearnedPowerDetails } | null = null;
/** Tests only. */
export function resetLearnedPowerCache(): void {
  cache = null;
}

/** How far before a plan's start to look for the state-log row in force at the start. */
const IN_FORCE_LOOKBACK_MS = 12 * 3_600_000;

async function loadLearnedPowerDetails(): Promise<LearnedPowerDetails> {
  const candidates = await db
    .select({
      id: chargeSchedules.id,
      chargerId: chargeSchedules.chargerId,
      remainingKwhAtStart: chargeSchedules.remainingKwhAtStart,
      startedAt: chargeSchedules.startedAt,
      endedAt: chargeSchedules.endedAt,
    })
    .from(chargeSchedules)
    .where(
      and(
        eq(chargeSchedules.status, "completed"),
        isNotNull(chargeSchedules.startedAt),
        isNotNull(chargeSchedules.endedAt),
      ),
    )
    .orderBy(desc(chargeSchedules.endedAt))
    .limit(CANDIDATE_LIMIT);
  if (candidates.length === 0) return { kw: null, samples: [] };

  const chargerIds = [...new Set(candidates.map((c) => c.chargerId))];

  const [logRows, oldest, resumeCounts] = await Promise.all([
    // Only the sample plans' own windows (plus a lookback for the row in force at each start).
    db
      .select({
        chargerId: chargerStateLog.chargerId,
        observedAt: chargerStateLog.observedAt,
        operationMode: chargerStateLog.operationMode,
        powerKw: chargerStateLog.powerKw,
      })
      .from(chargerStateLog)
      .where(
        or(
          ...candidates.map((c) =>
            and(
              eq(chargerStateLog.chargerId, c.chargerId),
              gte(chargerStateLog.observedAt, new Date(c.startedAt!.getTime() - IN_FORCE_LOOKBACK_MS)),
              lte(chargerStateLog.observedAt, c.endedAt!),
            ),
          ),
        ),
      )
      .orderBy(asc(chargerStateLog.observedAt)),
    db
      .select({ chargerId: chargerStateLog.chargerId, first: sql<Date | string>`min(${chargerStateLog.observedAt})` })
      .from(chargerStateLog)
      .where(inArray(chargerStateLog.chargerId, chargerIds))
      .groupBy(chargerStateLog.chargerId),
    db
      .select({ scheduleId: scheduleActions.scheduleId, count: sql<number>`count(*)` })
      .from(scheduleActions)
      .where(and(inArray(scheduleActions.scheduleId, candidates.map((c) => c.id)), eq(scheduleActions.action, "resume")))
      .groupBy(scheduleActions.scheduleId),
  ]);
  const oldestByCharger = new Map(oldest.map((o) => [o.chargerId, new Date(o.first)]));
  const resumeCountById = new Map(resumeCounts.map((r) => [r.scheduleId, Number(r.count)]));

  const samples: LearnedPowerSample[] = [];
  for (const plan of candidates) {
    if (samples.length >= SAMPLE_LIMIT) break;
    const startedAt = plan.startedAt!;
    const endedAt = plan.endedAt!;
    const logStart = oldestByCharger.get(plan.chargerId);
    let kw: number | null;
    if (logStart && logStart.getTime() <= startedAt.getTime()) {
      const forCharger: StateLogPoint[] = logRows
        .filter((r) => r.chargerId === plan.chargerId && r.observedAt.getTime() <= endedAt.getTime())
        .map((r) => ({ observedAt: r.observedAt, operationMode: r.operationMode, powerKw: r.powerKw == null ? null : Number(r.powerKw) }));
      const before = forCharger.filter((r) => r.observedAt.getTime() <= startedAt.getTime()).at(-1);
      const inside = forCharger.filter((r) => r.observedAt.getTime() > startedAt.getTime());
      kw = drawingPowerKw(before ? [before, ...inside] : inside, startedAt, endedAt);
    } else {
      kw =
        plan.remainingKwhAtStart != null && (resumeCountById.get(plan.id) ?? 0) <= 1
          ? wallClockKw({ remainingKwhAtStart: Number(plan.remainingKwhAtStart), startedAt, endedAt })
          : null;
    }
    if (kw != null && kw > 0) samples.push({ kw: Math.round(kw * 100) / 100, endedAt });
  }
  const kw = median(samples.map((s) => s.kw));
  return { kw: kw == null ? null : Math.round(kw * 100) / 100, samples };
}
