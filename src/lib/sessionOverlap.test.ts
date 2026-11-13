import { describe, expect, it } from "vitest";
import { dropOverlappingDuplicates, type OverlapRow } from "./sessionOverlap";

const row = (id: string, kind: string, session: string | null, start: string, end: string | null): OverlapRow => ({
  id,
  kind,
  zaptecSessionId: session,
  startedAt: new Date(start),
  endedAt: end ? new Date(end) : null,
});

describe("dropOverlappingDuplicates (D66)", () => {
  it("drops a row opened while another on the same Zaptec session was open", () => {
    const rows = [
      row("a", "manual", "s1", "2026-11-13T05:03:03Z", "2026-11-13T06:00:00Z"),
      row("b", "manual", "s1", "2026-11-13T05:03:04Z", "2026-11-13T06:00:00Z"),
      row("c", "preheat", "s1", "2026-11-13T05:30:00Z", "2026-11-13T05:40:00Z"),
    ];
    expect(dropOverlappingDuplicates(rows).map((r) => r.id)).toEqual(["a"]);
  });

  it("keeps rows that follow each other on one session (Stopp, then Lad nå) -- the 13 Nov pair", () => {
    const rows = [
      row("first", "manual", "47429855", "2026-11-13T05:03:03Z", "2026-11-13T05:38:03Z"),
      row("second", "manual", "47429855", "2026-11-13T05:38:07Z", "2026-11-13T05:42:12Z"),
    ];
    expect(dropOverlappingDuplicates(rows).map((r) => r.id)).toEqual(["first", "second"]);
  });

  it("never merges guest windows, unbound rows, or different sessions", () => {
    const rows = [
      row("m", "manual", "s1", "2026-11-13T05:00:00Z", "2026-11-13T06:00:00Z"),
      row("g", "guest", "s1", "2026-11-13T05:10:00Z", "2026-11-13T06:00:00Z"),
      row("u1", "manual", null, "2026-11-13T07:00:00Z", "2026-11-13T07:01:00Z"),
      row("u2", "manual", null, "2026-11-13T07:00:30Z", "2026-11-13T07:01:00Z"),
      row("other", "manual", "s2", "2026-11-13T05:10:00Z", "2026-11-13T06:00:00Z"),
    ];
    expect(dropOverlappingDuplicates(rows).map((r) => r.id)).toEqual(["m", "g", "u1", "u2", "other"]);
  });
});
