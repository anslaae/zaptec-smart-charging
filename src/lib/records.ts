import "server-only";
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, chargeSchedules, manualChargeSessions } from "@/lib/db/schema";
import { ActivityType } from "@/lib/activity/log";
import { reachedPercent } from "@/lib/push/notifications";
import type { SessionRecord, SessionTag } from "@/lib/ui/history";
import { sessionCost, type Prices } from "@/lib/pricing";

// Charging sessions as the app itself recorded them -- the data behind
// Historikk "Økter" and Innsikt. Deliberately not Zaptec's charge history
// (deprecated /api/chargehistory; /api/sessions/archived unverified, see
// DECISIONS.md Q4): every session the app authorised has its own row with
// the energy it delivered.

type Schedule = typeof chargeSchedules.$inferSelect;

/**
 * Sessions that delivered less than this aren't listed or counted (a car
 * that was already full, an automatic start that got nowhere). Old rows
 * without a recorded amount are kept. (Owner decision, DECISIONS.md D28.)
 */
export const MIN_SESSION_KWH = 0.1;

function costOf(kwh: number | null, start: Date, end: Date | null, prices: Prices) {
  if (kwh == null) return { costNok: null, gridNok: null };
  const cost = sessionCost(kwh, start, end, prices);
  return { costNok: cost.totalNok, gridNok: cost.gridNok };
}

/** kWh a plan delivered, from its reconcileSessionEnergy tracker. */
export function planDeliveredKwh(schedule: Schedule): number | null {
  if (schedule.zaptecSessionId == null || schedule.lastObservedSessionEnergyKwh == null) {
    // Plans from before the tracker existed: a completed one reached its target.
    return schedule.status === "completed" ? Number(schedule.targetEnergyKwh) : null;
  }
  const kwh = Number(schedule.priorSessionEnergyKwh ?? 0) + Number(schedule.lastObservedSessionEnergyKwh);
  return Math.max(0, Math.round(kwh * 100) / 100);
}

export async function loadSessionRecords(
  since: Date,
  capacityKwh: number,
  prices: Prices,
): Promise<{ records: SessionRecord[]; automaticStops: Date[] }> {
  const [plans, sessions, stops] = await Promise.all([
    db
      .select()
      .from(chargeSchedules)
      .where(
        and(
          inArray(chargeSchedules.status, ["completed", "cancelled"]),
          isNotNull(chargeSchedules.startedAt),
          gte(chargeSchedules.startedAt, since),
        ),
      ),
    db
      .select()
      .from(manualChargeSessions)
      .where(and(isNotNull(manualChargeSessions.endedAt), gte(manualChargeSessions.startedAt, since))),
    db
      .select({ createdAt: activityEvents.createdAt })
      .from(activityEvents)
      .where(and(eq(activityEvents.type, ActivityType.StoppedUnplanned), gte(activityEvents.createdAt, since))),
  ]);

  const records: SessionRecord[] = [];
  for (const plan of plans) {
    const kwh = planDeliveredKwh(plan);
    // A plan cancelled before it delivered anything isn't a session.
    if (plan.status === "cancelled" && !kwh) continue;
    records.push({
      id: plan.id,
      // Smart lading rows (UC16) are tagged "Smart" and belong to nobody in Innsikt.
      tag: plan.source === "smart" ? "smart" : "plan",
      startedAt: plan.startedAt!,
      endedAt: plan.endedAt,
      kwh,
      startPercent: plan.startPercent,
      endPercent:
        kwh != null
          ? reachedPercent({ startPercent: plan.startPercent, targetPercent: plan.targetPercent, deliveredKwh: kwh, capacityKwh })
          : null,
      userId: plan.source === "smart" ? null : plan.createdByUserId,
      ...costOf(kwh, plan.startedAt!, plan.endedAt, prices),
    });
  }
  for (const session of sessions) {
    const tag = session.kind as SessionTag;
    records.push({
      id: session.id,
      tag,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      kwh: session.energyKwh != null ? Number(session.energyKwh) : null,
      startPercent: null,
      endPercent: null,
      // Per-person totals: guest and automatic sessions belong to nobody.
      userId: tag === "manual" || tag === "preheat" ? session.startedByUserId : null,
      guestName: session.guestName,
      ...costOf(session.energyKwh != null ? Number(session.energyKwh) : null, session.startedAt, session.endedAt, prices),
    });
  }
  return {
    records: records.filter((r) => r.kwh == null || r.kwh >= MIN_SESSION_KWH),
    automaticStops: stops.map((s) => s.createdAt),
  };
}
