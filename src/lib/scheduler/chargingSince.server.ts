import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { chargeSchedules, chargerStateLog, manualChargeSessions } from "@/lib/db/schema";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import type { ChargerState } from "@/lib/zaptec/types";
import { chargingSinceFromLog, withChargeDuration } from "./chargingSince";

// D84, the DB side. Called from getChargerState (zaptec/client.ts), so the
// tick, Hjem and every other reader get the same chargeDurationSeconds. Only
// queries while the car is charging and Zaptec left 701 out; never throws.

const LOOKBACK_MS = 24 * 3_600_000;
const MAX_ROWS = 200;

export async function fillChargeDuration(state: ChargerState, now: Date): Promise<ChargerState> {
  if (state.chargeDurationSeconds != null || state.operationMode !== ChargerOperationMode.Charging) return state;
  try {
    const from = new Date(now.getTime() - LOOKBACK_MS);
    const [rows, plans, sessions] = await Promise.all([
      db
        .select({
          observedAt: chargerStateLog.observedAt,
          operationMode: chargerStateLog.operationMode,
          powerKw: chargerStateLog.powerKw,
        })
        .from(chargerStateLog)
        .where(and(eq(chargerStateLog.chargerId, state.chargerId), gte(chargerStateLog.observedAt, from)))
        .orderBy(desc(chargerStateLog.observedAt))
        .limit(MAX_ROWS),
      db
        .select({ startedAt: chargeSchedules.startedAt })
        .from(chargeSchedules)
        .where(
          and(
            eq(chargeSchedules.chargerId, state.chargerId),
            inArray(chargeSchedules.status, ["pending", "active"]),
            isNotNull(chargeSchedules.startedAt),
          ),
        ),
      db
        .select({ startedAt: manualChargeSessions.startedAt })
        .from(manualChargeSessions)
        .where(and(eq(manualChargeSessions.chargerId, state.chargerId), isNull(manualChargeSessions.endedAt))),
    ]);
    const logSince = chargingSinceFromLog(
      rows.map((r) => ({ ...r, powerKw: r.powerKw == null ? null : Number(r.powerKw) })),
    );
    const starts = [...plans, ...sessions]
      .map((r) => r.startedAt)
      .filter((d): d is Date => d != null && d.getTime() >= from.getTime());
    const fallback = starts.length ? new Date(Math.max(...starts.map((d) => d.getTime()))) : null;
    // H2: the log knows this charger. If its newest row isn't drawing, the
    // car started after that row (this tick logs it next): duration ~0, never
    // an older startedAt from before a pause. The app's own start only
    // stands in when the log has nothing at all.
    if (rows.length > 0) return withChargeDuration(state, logSince ?? now, null, now);
    return withChargeDuration(state, null, fallback, now);
  } catch (error) {
    console.warn("[scheduler] charging-since lookup failed:", error instanceof Error ? error.message : error);
    return state;
  }
}
