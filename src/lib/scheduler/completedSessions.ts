// D72: what a finished Zaptec session (CompletedSession, observation 723)
// changes in our own session rows. Pure, unit tested; the tick applies it
// (completedSessions.server.ts).

export interface SessionRowEnergy {
  zaptecSessionId: string | null;
  startEnergyKwh: string | null;
  lastObservedEnergyKwh: string | null;
  endedAt: Date | null;
}

export interface CompletedFact {
  sessionId: string;
  endedAt: Date;
  energyKwh: number;
}

/**
 * A Lad nå / Forvarm / automatic / guest row bound to the session that just
 * ended, and still running when it ended (open, or closed by the tick that
 * saw the unplug), gets the exact final counter instead of the tick's last
 * reading. A row closed earlier (Stopp, then a new row on the same plug-in)
 * measured its own part and is left alone. Never lowers a reading.
 * Returns the new readings, or null when nothing changes.
 */
export function exactRowEnergy(
  row: SessionRowEnergy,
  completed: CompletedFact,
): { lastObservedEnergyKwh: string; energyKwh: string | null } | null {
  if (row.zaptecSessionId !== completed.sessionId) return null;
  // Closed before the session ended: it covered only part of it.
  if (row.endedAt != null && row.endedAt.getTime() < completed.endedAt.getTime()) return null;
  const seen = row.lastObservedEnergyKwh == null ? null : Number(row.lastObservedEnergyKwh);
  if (seen != null && completed.energyKwh <= seen + 0.0005) return null;
  const last = completed.energyKwh.toFixed(2);
  const delivered = Math.max(0, completed.energyKwh - Number(row.startEnergyKwh ?? 0));
  return {
    lastObservedEnergyKwh: last,
    // Closed rows store their energy; an open one gets it when it closes.
    energyKwh: row.endedAt != null ? (Math.round(delivered * 100) / 100).toFixed(2) : null,
  };
}
