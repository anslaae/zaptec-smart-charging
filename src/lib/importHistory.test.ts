import { describe, expect, it } from "vitest";
import { parseZaptecTime, planImport, type ZaptecHistorySession } from "./importHistory";

const z = (id: string, start: string, end: string | null, kwh = 10): ZaptecHistorySession => ({
  id,
  startedAt: start,
  endedAt: end,
  energyKwh: kwh,
});

describe("parseZaptecTime (D70)", () => {
  it("reads Zaptec's zone-less times as UTC", () => {
    expect(parseZaptecTime("2026-05-23T17:02:11.123").toISOString()).toBe("2026-05-23T17:02:11.123Z");
    expect(parseZaptecTime("2026-05-23T17:02:11Z").toISOString()).toBe("2026-05-23T17:02:11.000Z");
  });
});

describe("planImport (D70)", () => {
  const sessions = [
    z("old-1", "2026-05-23T17:00:00", "2026-05-23T20:00:00", 21.437),
    z("old-2", "2026-06-02T18:00:00", "2026-06-02T19:30:00", 8),
    z("app-bound", "2026-10-20T01:00:00", "2026-10-20T05:00:00"),
    z("app-unbound", "2026-10-06T16:00:00", "2026-10-06T18:00:00"),
    z("running", "2026-11-13T08:00:00", null),
  ];
  const appRows = [
    // A plan bound to Zaptec's session id
    { zaptecSessionId: "app-bound", startedAt: new Date("2026-10-20T01:05:00Z") },
    // An early Lad nå row without a zaptec id that started inside "app-unbound"
    { zaptecSessionId: null, startedAt: new Date("2026-10-06T16:01:00Z") },
  ];

  it("imports only sessions the app doesn't have", () => {
    const { insert, skipped } = planImport(sessions, appRows);
    expect(insert.map((r) => r.zaptecSessionId)).toEqual(["old-1", "old-2"]);
    expect(insert[0]).toEqual({
      zaptecSessionId: "old-1",
      startedAt: new Date("2026-05-23T17:00:00Z"),
      endedAt: new Date("2026-05-23T20:00:00Z"),
      energyKwh: 21.44,
    });
    expect(Object.fromEntries(skipped.map((s) => [s.session.id, s.reason]))).toEqual({
      "app-bound": "same-session",
      "app-unbound": "app-row-inside",
      running: "still-running",
    });
  });

  it("time overlap only counts for app rows without a zaptec id", () => {
    // A bound row of another session starting inside doesn't hide this one.
    const rows = [{ zaptecSessionId: "other", startedAt: new Date("2026-05-23T18:00:00Z") }];
    expect(planImport([sessions[0]], rows).insert).toHaveLength(1);
    // A row starting just outside doesn't either.
    const outside = [{ zaptecSessionId: null, startedAt: new Date("2026-05-23T20:00:01Z") }];
    expect(planImport([sessions[0]], outside).insert).toHaveLength(1);
  });

  it("is idempotent: a second run inserts nothing", () => {
    const first = planImport(sessions, appRows);
    const afterImport = [
      ...appRows,
      ...first.insert.map((r) => ({ zaptecSessionId: r.zaptecSessionId, startedAt: r.startedAt })),
    ];
    expect(planImport(sessions, afterImport).insert).toEqual([]);
  });

  it("a session listed twice is imported once", () => {
    expect(planImport([sessions[0], sessions[0]], []).insert).toHaveLength(1);
  });
});
