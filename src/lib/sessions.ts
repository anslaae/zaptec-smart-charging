import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { manualChargeSessions } from "@/lib/db/schema";
import type { ChargerState } from "@/lib/zaptec/types";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import { getChargerState, listChargers } from "@/lib/zaptec/client";
import { defaultCarId } from "@/lib/cars";

// Every non-plan authorisation lives in manual_charge_sessions with a `kind`
// (see schema.ts): Lad nå, Forvarm, a guest window (UC15) or an automatic
// session (UC14). This module opens, tracks and closes them, recording the
// energy each one delivered so Historikk/Innsikt don't need Zaptec's
// deprecated charge-history API.

export type SessionKind = "manual" | "preheat" | "guest" | "automatic";
export const SESSION_KINDS: readonly SessionKind[] = ["manual", "preheat", "guest", "automatic"];

export type SessionRow = typeof manualChargeSessions.$inferSelect;

const kwh = (value: number | null | undefined) => (value == null ? null : value.toFixed(2));

/** Energy a session delivered: the charger's session counter now minus at open. */
export function deliveredKwh(
  row: Pick<SessionRow, "startEnergyKwh" | "lastObservedEnergyKwh">,
): number | null {
  if (row.lastObservedEnergyKwh == null) return null;
  const delivered = Number(row.lastObservedEnergyKwh) - Number(row.startEnergyKwh ?? 0);
  return Math.max(0, Math.round(delivered * 100) / 100);
}

/**
 * Opens a session. The physical Zaptec session is bound by the next tick
 * (trackSession), so the actions don't need a charger-state round trip.
 */
export async function openSession(
  chargerId: string,
  kind: SessionKind,
  userId: string | null,
  state?: ChargerState,
  guestName: string | null = null,
  targetKwh: number | null = null,
): Promise<void> {
  // One session at a time (guest windows aside): starting what's already
  // running keeps the open row; starting something else (Lad nå while
  // Forvarm is on) ends the first. Two taps used to leave two rows.
  const open = await db
    .select()
    .from(manualChargeSessions)
    .where(and(eq(manualChargeSessions.chargerId, chargerId), isNull(manualChargeSessions.endedAt)));
  if (open.some((row) => row.kind === kind)) return;
  if (kind !== "guest") {
    for (const row of open) if (row.kind !== "guest") await closeSession(row);
  }
  const bound = state?.sessionId != null;
  await db.insert(manualChargeSessions).values({
    chargerId,
    kind,
    // A guest's car never counts for ours (design 6c).
    carId: kind === "guest" ? null : await defaultCarId(),
    startedByUserId: userId,
    guestName,
    targetKwh: targetKwh == null ? null : targetKwh.toFixed(2),
    zaptecSessionId: bound ? state.sessionId : null,
    startEnergyKwh: bound ? kwh(state.sessionEnergyKwh ?? 0) : null,
    lastObservedEnergyKwh: bound ? kwh(state.sessionEnergyKwh ?? 0) : null,
  });
}

export async function closeSession(row: SessionRow, at: Date = new Date()): Promise<void> {
  await db
    .update(manualChargeSessions)
    .set({ endedAt: at, energyKwh: kwh(deliveredKwh(row)) })
    .where(eq(manualChargeSessions.id, row.id));
}

/** Closes every open session on a charger (Stopp lading), recording each one's energy. */
export async function closeSessions(
  chargerId: string,
  options: { keepGuest?: boolean } = {},
  at: Date = new Date(),
): Promise<SessionRow[]> {
  const open = (
    await db
      .select()
      .from(manualChargeSessions)
      .where(and(eq(manualChargeSessions.chargerId, chargerId), isNull(manualChargeSessions.endedAt)))
  ).filter((row) => !(options.keepGuest && row.kind === "guest"));
  for (const row of open) await closeSession(row, at);
  return open;
}

/** The charger's state right now (one Zaptec call), or undefined when it can't be read. */
async function readChargerState(chargerId: string): Promise<ChargerState | undefined> {
  const charger = (await listChargers().catch(() => [])).find((c) => c.id === chargerId);
  if (!charger) return undefined;
  return getChargerState(charger.id, charger.isOnline, charger.circuitId, charger.installationId).catch(() => undefined);
}

/**
 * Right after Lad nå / Forvarm (run with after(), so the button isn't kept
 * waiting): binds the new row to the physical session now instead of at the
 * next tick, so even a session stopped within a minute knows its start.
 */
export async function bindOpenSessions(chargerId: string): Promise<void> {
  const state = await readChargerState(chargerId);
  if (!state || state.operationMode === ChargerOperationMode.Disconnected) return;
  const open = await db
    .select()
    .from(manualChargeSessions)
    .where(and(eq(manualChargeSessions.chargerId, chargerId), isNull(manualChargeSessions.endedAt)));
  // Not guest windows: an unbound one waits for the guest's car, not this one.
  for (const row of open) if (row.kind !== "guest") await trackSession(row, state);
}

/**
 * Right after Stopp lading (with after()): the energy recorded at close is
 * the tick's last reading, up to a minute old; this replaces it with the
 * charger's counter now, for the rows that belong to the current session.
 */
export async function finalizeSessionEnergy(chargerId: string, rowIds: string[]): Promise<void> {
  if (rowIds.length === 0) return;
  const state = await readChargerState(chargerId);
  if (!state || state.sessionId == null || state.sessionEnergyKwh == null) return;
  const rows = await db.select().from(manualChargeSessions).where(inArray(manualChargeSessions.id, rowIds));
  for (const row of rows) {
    if (row.zaptecSessionId !== state.sessionId) continue;
    const reading = kwh(state.sessionEnergyKwh);
    const energy = deliveredKwh({ startEnergyKwh: row.startEnergyKwh, lastObservedEnergyKwh: reading });
    await db
      .update(manualChargeSessions)
      .set({ lastObservedEnergyKwh: reading, energyKwh: kwh(energy) })
      .where(eq(manualChargeSessions.id, row.id));
  }
}

/**
 * Called by the tick for each open session while a car is connected. Binds
 * the row to the physical session the first time it's seen -- a guest
 * window counts from 0 (the guest plugs in after it was opened), the others
 * from the counter at that moment -- then keeps the latest energy reading.
 * Writes only when something changed.
 */
export async function trackSession(row: SessionRow, state: ChargerState): Promise<SessionRow> {
  if (state.sessionId == null) return row;
  const reading = kwh(state.sessionEnergyKwh ?? 0);
  const patch: Partial<SessionRow> = {};
  if (row.zaptecSessionId == null) {
    patch.zaptecSessionId = state.sessionId;
    patch.startEnergyKwh = row.kind === "guest" ? "0.00" : reading;
  } else if (row.zaptecSessionId !== state.sessionId) {
    return row; // a different physical session than the one this row covers
  }
  if (reading !== row.lastObservedEnergyKwh) patch.lastObservedEnergyKwh = reading;
  if (Object.keys(patch).length === 0) return row;
  await db.update(manualChargeSessions).set(patch).where(eq(manualChargeSessions.id, row.id));
  return { ...row, ...patch };
}

/**
 * Whether an open session ends now that no car is connected. A guest window
 * opened before the guest arrived (never bound to a session) stays open
 * until the guest has plugged in and then unplugged.
 */
export function endsOnDisconnect(row: Pick<SessionRow, "kind" | "zaptecSessionId">): boolean {
  return row.kind !== "guest" || row.zaptecSessionId != null;
}
