import "server-only";
import { desc, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { chargerStateLog } from "@/lib/db/schema";
import type { ChargerState } from "@/lib/zaptec/types";
import { STATE_LOG_RETENTION_MS, stateLogChanged, toLoggedState, type LoggedState } from "./stateLog";

// D69, the tick's side: one row per charger whenever its state changed
// meaningfully (stateLogChanged), compared with that charger's last row; then
// a cheap prune of rows older than 30 days. Returns how many rows it wrote.
export async function logChargerStates(states: ChargerState[], now: Date): Promise<number> {
  let written = 0;
  for (const state of states) {
    const [last] = await db
      .select()
      .from(chargerStateLog)
      .where(eq(chargerStateLog.chargerId, state.chargerId))
      .orderBy(desc(chargerStateLog.observedAt))
      .limit(1);
    const prev: LoggedState | null = last
      ? {
          operationMode: last.operationMode,
          powerKw: last.powerKw == null ? null : Number(last.powerKw),
          phaseAmps: [last.phase1Amps, last.phase2Amps, last.phase3Amps],
          finalStopActive: last.finalStopActive,
          sessionId: last.sessionId,
        }
      : null;
    const next = toLoggedState(state);
    if (!stateLogChanged(prev, next)) continue;
    await db.insert(chargerStateLog).values({
      chargerId: state.chargerId,
      observedAt: now,
      operationMode: next.operationMode,
      powerKw: next.powerKw == null ? null : next.powerKw.toFixed(2),
      phase1Amps: next.phaseAmps[0],
      phase2Amps: next.phaseAmps[1],
      phase3Amps: next.phaseAmps[2],
      finalStopActive: next.finalStopActive,
      sessionId: next.sessionId,
      raw: state.rawObservations ?? null,
    });
    written++;
  }
  await db.delete(chargerStateLog).where(lt(chargerStateLog.observedAt, new Date(now.getTime() - STATE_LOG_RETENTION_MS)));
  return written;
}
