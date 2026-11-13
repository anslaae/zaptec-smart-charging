// D70: which Zaptec sessions (deprecated /api/chargehistory) to import as
// manual_charge_sessions rows of kind "imported" -- the ones from before the
// app recorded its own. Pure, unit tested; scripts/import-zaptec-history.mts
// does the fetching and inserting.

export interface ZaptecHistorySession {
  /** Zaptec's session id, the same GUID the app stores as zaptec_session_id. */
  id: string;
  /** "2026-05-23T17:02:11.123" -- UTC without a Z (or with one). */
  startedAt: string;
  endedAt: string | null;
  energyKwh: number;
}

/** An app row (plan or session) that may already cover a Zaptec session. */
export interface AppRow {
  zaptecSessionId: string | null;
  startedAt: Date;
}

export interface ImportRow {
  zaptecSessionId: string;
  startedAt: Date;
  endedAt: Date;
  energyKwh: number;
}

export type SkipReason = "same-session" | "app-row-inside" | "still-running" | "bad-time";

/** Zaptec's times are UTC but come without a zone; read them as UTC either way. */
export function parseZaptecTime(value: string): Date {
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/.test(value);
  return new Date(hasZone ? value : `${value}Z`);
}

/**
 * Splits Zaptec's sessions into rows to insert and skips. Skipped:
 * - one with a zaptec_session_id we already have (on any plan or session
 *   row -- including earlier imports, which makes this idempotent);
 * - one with an app row without a zaptec id that started inside it (rows
 *   from before the app bound sessions to Zaptec's id);
 * - one still running (no end) or with an unreadable time.
 */
export function planImport(
  sessions: ZaptecHistorySession[],
  appRows: AppRow[],
): { insert: ImportRow[]; skipped: { session: ZaptecHistorySession; reason: SkipReason }[] } {
  const knownIds = new Set(appRows.map((r) => r.zaptecSessionId).filter((id): id is string => id != null));
  const unbound = appRows.filter((r) => r.zaptecSessionId == null);
  const insert: ImportRow[] = [];
  const skipped: { session: ZaptecHistorySession; reason: SkipReason }[] = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    if (knownIds.has(session.id) || seen.has(session.id)) {
      skipped.push({ session, reason: "same-session" });
      continue;
    }
    if (session.endedAt == null) {
      skipped.push({ session, reason: "still-running" });
      continue;
    }
    const startedAt = parseZaptecTime(session.startedAt);
    const endedAt = parseZaptecTime(session.endedAt);
    if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
      skipped.push({ session, reason: "bad-time" });
      continue;
    }
    const inside = unbound.some(
      (r) => r.startedAt.getTime() >= startedAt.getTime() && r.startedAt.getTime() <= endedAt.getTime(),
    );
    if (inside) {
      skipped.push({ session, reason: "app-row-inside" });
      continue;
    }
    seen.add(session.id);
    insert.push({ zaptecSessionId: session.id, startedAt, endedAt, energyKwh: Math.round(session.energyKwh * 100) / 100 });
  }
  return { insert, skipped };
}
