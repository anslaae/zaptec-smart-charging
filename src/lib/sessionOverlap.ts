// D66: two Lad nå / Forvarm rows open at the same time on the same Zaptec
// session both measure the same energy (each counts "counter now minus at
// open"), so Historikk/Innsikt would count it twice. Rows that merely follow
// each other on one session -- Stopp, then Lad nå again -- each measured
// their own part and are both kept. Guest windows are never merged.

export interface OverlapRow {
  id: string;
  kind: string;
  zaptecSessionId: string | null;
  startedAt: Date;
  endedAt: Date | null;
}

/** Drops a row that started while an earlier row on the same Zaptec session was still open. */
export function dropOverlappingDuplicates<T extends OverlapRow>(rows: T[]): T[] {
  const sorted = [...rows].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const keptBySession = new Map<string, T[]>();
  const dropped = new Set<string>();
  for (const row of sorted) {
    if (row.kind === "guest" || row.zaptecSessionId == null) continue;
    const earlier = keptBySession.get(row.zaptecSessionId) ?? [];
    const overlaps = earlier.some((e) => e.endedAt == null || e.endedAt.getTime() > row.startedAt.getTime());
    if (overlaps) dropped.add(row.id);
    else keptBySession.set(row.zaptecSessionId, [...earlier, row]);
  }
  return rows.filter((r) => !dropped.has(r.id));
}
