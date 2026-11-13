import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChargerState } from "@/lib/zaptec/types";

// D72 against an in-memory Postgres (real migrations, 0025 included).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => (await import("@/lib/db/testDb")).createTestDb());

const { db } = await import("@/lib/db");
const { manualChargeSessions, zaptecSessions } = await import("@/lib/db/schema");
const { recordCompletedSessions } = await import("./completedSessions.server");
const { recordHourly } = await import("@/lib/records");

const start = new Date("2026-11-13T05:41:27Z");
const end = new Date("2026-11-13T09:16:41Z");
const readings = [
  { at: start.toISOString(), kwh: 431.595 },
  { at: "2026-11-13T06:00:00.000Z", kwh: 432.839 },
  { at: "2026-11-13T07:00:00.000Z", kwh: 437.178 },
  { at: "2026-11-13T08:00:00.000Z", kwh: 441.424 },
  { at: "2026-11-13T09:00:00.000Z", kwh: 441.837 },
  { at: end.toISOString(), kwh: 441.837 },
];
const state = (sessionId: string) =>
  ({
    chargerId: "charger-1",
    sessionId: null,
    lastCompletedSession: { sessionId, startedAt: start.toISOString(), endedAt: end.toISOString(), energyKwh: 10.242, meterReadings: readings },
  }) as unknown as ChargerState;

beforeEach(async () => {
  await db.delete(manualChargeSessions);
  await db.delete(zaptecSessions);
});

describe("recordCompletedSessions (D72)", () => {
  it("stores the session once and corrects the row that ran to its end", async () => {
    await db.insert(manualChargeSessions).values([
      // Lad nå A, stopped at 06:38 -- measured its own part.
      {
        chargerId: "charger-1",
        kind: "manual",
        startedAt: start,
        endedAt: new Date("2026-11-13T06:38:00Z"),
        zaptecSessionId: "s-a",
        startEnergyKwh: "0.00",
        lastObservedEnergyKwh: "4.00",
        energyKwh: "4.00",
      },
      // Lad nå B, closed by the unplug tick with the last reading it saw.
      {
        chargerId: "charger-1",
        kind: "manual",
        startedAt: new Date("2026-11-13T06:38:00Z"),
        endedAt: new Date("2026-11-13T09:17:30Z"),
        zaptecSessionId: "s-a",
        startEnergyKwh: "4.00",
        lastObservedEnergyKwh: "9.90",
        energyKwh: "5.90",
      },
    ]);
    await recordCompletedSessions([state("s-a")]);
    await recordCompletedSessions([state("s-a")]);

    const stored = await db.select().from(zaptecSessions);
    expect(stored).toHaveLength(1);
    expect(Number(stored[0].energyKwh)).toBeCloseTo(10.242);
    expect(stored[0].meterReadings).toEqual(readings);

    const rows = (await db.select().from(manualChargeSessions)).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    expect(rows[0].energyKwh).toBe("4.00");
    expect(rows[1].lastObservedEnergyKwh).toBe("10.24");
    expect(rows[1].energyKwh).toBe("6.24");
  });

  it("ignores an observation without a session id", async () => {
    await recordCompletedSessions([state("")]);
    expect(await db.select().from(zaptecSessions)).toHaveLength(0);
  });
});

describe("recordHourly", () => {
  const sessions = [{ chargerId: "charger-1", startedAt: start, endedAt: end, meterReadings: readings }];

  it("gives a record the kWh per hour of the Zaptec session it overlaps", () => {
    const hours = recordHourly(sessions, "charger-1", start, end)!;
    expect(hours).toHaveLength(4);
    expect(hours.reduce((s, h) => s + h.kwh, 0)).toBeCloseTo(10.242, 2);
  });

  it("is null for another charger, no end, or no overlapping session", () => {
    expect(recordHourly(sessions, "charger-2", start, end)).toBeNull();
    expect(recordHourly(sessions, "charger-1", start, null)).toBeNull();
    expect(recordHourly(sessions, "charger-1", new Date("2026-11-14T00:00:00Z"), new Date("2026-11-14T02:00:00Z"))).toBeNull();
  });
});
