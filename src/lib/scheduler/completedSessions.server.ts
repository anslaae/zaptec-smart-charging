import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { manualChargeSessions, zaptecSessions } from "@/lib/db/schema";
import type { ChargerState } from "@/lib/zaptec/types";
import { exactRowEnergy } from "./completedSessions";

// D72: once per ended Zaptec session, store CompletedSession (723) -- exact
// energy and the hourly meter readings -- and give our rows on that session
// the exact final energy. Runs on full ticks; the observation is part of
// the /state read the tick makes anyway, so no extra Zaptec call. A warm
// instance remembers what it recorded, so an unchanged observation costs no
// query either.

const recorded = new Set<string>();

export async function recordCompletedSessions(states: ChargerState[]): Promise<void> {
  for (const state of states) {
    const completed = state.lastCompletedSession;
    const sessionId = completed?.sessionId;
    if (!completed || !sessionId || recorded.has(sessionId)) continue;
    const endedAt = new Date(completed.endedAt);
    const startedAt = new Date(completed.startedAt);
    if (Number.isNaN(endedAt.getTime()) || Number.isNaN(startedAt.getTime())) continue;

    await db
      .insert(zaptecSessions)
      .values({
        id: sessionId,
        chargerId: state.chargerId,
        startedAt,
        endedAt,
        energyKwh: completed.energyKwh.toFixed(3),
        meterReadings: completed.meterReadings ?? null,
      })
      .onConflictDoNothing();

    // The row pass runs until it has succeeded once on this instance, not
    // only right after the insert, so a failed update is retried next tick.
    // It's idempotent: exactRowEnergy only ever raises a reading.
    const rows = await db.select().from(manualChargeSessions).where(eq(manualChargeSessions.zaptecSessionId, sessionId));
    for (const row of rows) {
      const patch = exactRowEnergy(row, { sessionId, endedAt, energyKwh: completed.energyKwh });
      if (!patch) continue;
      await db
        .update(manualChargeSessions)
        .set(patch.energyKwh != null ? patch : { lastObservedEnergyKwh: patch.lastObservedEnergyKwh })
        .where(eq(manualChargeSessions.id, row.id));
    }
    recorded.add(sessionId);
  }
}
