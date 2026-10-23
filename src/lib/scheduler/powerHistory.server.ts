import "server-only";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { chargeSchedules, scheduleActions } from "@/lib/db/schema";
import { computeLearnedPowerKw } from "./powerHistory";

// Headroom before filtering out paused schedules below, so the final sample
// set isn't thinned out by sessions that happened to involve a pause.
const CANDIDATE_LIMIT = 20;
const SAMPLE_LIMIT = 10;

/**
 * The learned real-world charge rate (see powerHistory.ts), from the most
 * recent completed, never-paused schedules -- paused sessions are excluded
 * because their wall-clock duration includes paused time, which would
 * understate the real rate. Returns null with no usable history yet (a
 * fresh install, or every past schedule predates remainingKwhAtStart).
 */
export async function getLearnedPowerKw(): Promise<number | null> {
  const candidates = await db
    .select({
      id: chargeSchedules.id,
      remainingKwhAtStart: chargeSchedules.remainingKwhAtStart,
      startedAt: chargeSchedules.startedAt,
      endedAt: chargeSchedules.endedAt,
    })
    .from(chargeSchedules)
    .where(
      and(
        eq(chargeSchedules.status, "completed"),
        isNotNull(chargeSchedules.remainingKwhAtStart),
        isNotNull(chargeSchedules.startedAt),
        isNotNull(chargeSchedules.endedAt),
      ),
    )
    .orderBy(desc(chargeSchedules.endedAt))
    .limit(CANDIDATE_LIMIT);

  if (candidates.length === 0) return null;

  const resumeCounts = await db
    .select({ scheduleId: scheduleActions.scheduleId, count: sql<number>`count(*)` })
    .from(scheduleActions)
    .where(
      and(
        inArray(
          scheduleActions.scheduleId,
          candidates.map((c) => c.id),
        ),
        eq(scheduleActions.action, "resume"),
      ),
    )
    .groupBy(scheduleActions.scheduleId);
  const resumeCountById = new Map(resumeCounts.map((r) => [r.scheduleId, Number(r.count)]));

  const samples = candidates
    .filter((c) => (resumeCountById.get(c.id) ?? 0) <= 1)
    .slice(0, SAMPLE_LIMIT)
    .map((c) => ({
      remainingKwhAtStart: Number(c.remainingKwhAtStart),
      startedAt: c.startedAt!,
      endedAt: c.endedAt!,
    }));

  return computeLearnedPowerKw(samples);
}
