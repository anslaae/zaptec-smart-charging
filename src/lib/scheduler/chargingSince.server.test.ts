import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import type { ChargerState } from "@/lib/zaptec/types";

// D84 against an in-memory Postgres (real migrations).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => (await import("@/lib/db/testDb")).createTestDb());

const { db } = await import("@/lib/db");
const { chargeSchedules, chargerStateLog } = await import("@/lib/db/schema");
const { fillChargeDuration } = await import("./chargingSince.server");

const t0 = new Date("2026-11-20T22:00:00Z");
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const charging = { chargerId: "c1", operationMode: ChargerOperationMode.Charging, chargeDurationSeconds: null } as ChargerState;

beforeEach(async () => {
  await db.delete(chargerStateLog);
  await db.delete(chargeSchedules);
});

describe("fillChargeDuration (D84)", () => {
  it("from the state log's current drawing run", async () => {
    await db.insert(chargerStateLog).values([
      { chargerId: "c1", observedAt: at(0), operationMode: 5, powerKw: "0" },
      { chargerId: "c1", observedAt: at(10), operationMode: 3, powerKw: "4.36" },
      { chargerId: "c1", observedAt: at(50), operationMode: 3, powerKw: "4.40" },
    ]);
    expect((await fillChargeDuration(charging, at(70))).chargeDurationSeconds).toBe(3600);
  });

  it("falls back to an open plan's startedAt before the log has a row", async () => {
    await db.insert(chargeSchedules).values({ chargerId: "c1", chargerName: "L", targetEnergyKwh: "10", readyBy: at(600), status: "active", startedAt: at(5) });
    expect((await fillChargeDuration(charging, at(35))).chargeDurationSeconds).toBe(1800);
  });

  it("H2: newest log row paused -> charging just started (0 s), never the plan's older startedAt", async () => {
    await db.insert(chargeSchedules).values({ chargerId: "c1", chargerName: "L", targetEnergyKwh: "10", readyBy: at(600), status: "active", startedAt: at(-180) });
    await db.insert(chargerStateLog).values([
      { chargerId: "c1", observedAt: at(-180), operationMode: 3, powerKw: "4.40" },
      { chargerId: "c1", observedAt: at(-120), operationMode: 5, powerKw: "0" },
    ]);
    expect((await fillChargeDuration(charging, at(0))).chargeDurationSeconds).toBe(0);
  });

  it("no query result changes a reported value or a non-charging state", async () => {
    expect((await fillChargeDuration({ ...charging, chargeDurationSeconds: 42 }, at(10))).chargeDurationSeconds).toBe(42);
    expect((await fillChargeDuration({ ...charging, operationMode: 5 }, at(10))).chargeDurationSeconds).toBeNull();
  });
});
