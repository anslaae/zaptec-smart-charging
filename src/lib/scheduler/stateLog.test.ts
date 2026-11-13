import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import type { ChargerState } from "@/lib/zaptec/types";
import { stateLogChanged, toLoggedState } from "./stateLog";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", async () => (await import("@/lib/db/testDb")).createTestDb());
const { db } = await import("@/lib/db");
const { chargerStateLog } = await import("@/lib/db/schema");
const { logChargerStates } = await import("./stateLog.server");

// The 13 Nov readings: charging at ~3 kW, then the car stopped (mode 5).
const charging = {
  chargerId: "charger-1",
  operationMode: ChargerOperationMode.Charging,
  instantPowerWatts: 3000,
  phaseCurrentsAmps: [13.1, 0.03, 0.03],
  finalStopActive: false,
  sessionId: "s1",
  rawObservations: { "710": "3", "513": "3000", "507": "13.1" },
} as unknown as ChargerState;
const stopped = {
  ...charging,
  operationMode: ChargerOperationMode.StoppedOrIdle,
  instantPowerWatts: 0,
  phaseCurrentsAmps: [0.048, 0.025, 0.027],
  finalStopActive: true,
} as ChargerState;
const t0 = new Date("2026-11-13T08:30:00Z");
const at = (min: number) => new Date(t0.getTime() + min * 60_000);

describe("stateLogChanged (D69)", () => {
  const base = toLoggedState(charging);
  it("the first reading is logged", () => expect(stateLogChanged(null, base)).toBe(true));
  it("an unchanged state is not", () => expect(stateLogChanged(base, toLoggedState({ ...charging }))).toBe(false));
  it("small power wobbles are not", () =>
    expect(stateLogChanged(base, toLoggedState({ ...charging, instantPowerWatts: 3250 }))).toBe(false));
  it("mode, final stop, session and > 0.3 kW are", () => {
    expect(stateLogChanged(base, toLoggedState({ ...charging, operationMode: ChargerOperationMode.StoppedOrIdle }))).toBe(true);
    expect(stateLogChanged(base, toLoggedState({ ...charging, finalStopActive: true }))).toBe(true);
    expect(stateLogChanged(base, toLoggedState({ ...charging, sessionId: "s2" }))).toBe(true);
    expect(stateLogChanged(base, toLoggedState({ ...charging, instantPowerWatts: 3400 }))).toBe(true);
  });
  it("a phase crossing 0.5 A is, even if the mode stays 3", () => {
    expect(stateLogChanged(base, toLoggedState({ ...charging, phaseCurrentsAmps: [0.04, 0.03, 0.03], instantPowerWatts: 2900 }))).toBe(true);
    expect(stateLogChanged(base, toLoggedState({ ...charging, phaseCurrentsAmps: [12.5, 0.04, 0.02] }))).toBe(false);
  });
});

describe("logChargerStates (D69)", () => {
  beforeEach(async () => {
    await db.delete(chargerStateLog);
  });
  const rows = () => db.select().from(chargerStateLog).orderBy(chargerStateLog.observedAt);

  it("writes on a change, not every tick, with the raw observations", async () => {
    expect(await logChargerStates([charging], at(0))).toBe(1);
    expect(await logChargerStates([charging], at(1))).toBe(0);
    expect(await logChargerStates([{ ...charging, instantPowerWatts: 3100 }], at(2))).toBe(0);
    expect(await logChargerStates([stopped], at(7))).toBe(1);
    expect(await logChargerStates([stopped], at(8))).toBe(0);
    const logged = await rows();
    expect(logged.map((r) => r.operationMode)).toEqual([3, 5]);
    expect(logged[1]).toMatchObject({ powerKw: "0.00", finalStopActive: true, sessionId: "s1" });
    expect(logged[1].phase1Amps).toBeCloseTo(0.048);
    expect(logged[0].raw).toEqual({ "710": "3", "513": "3000", "507": "13.1" });
  });

  it("prunes rows older than 30 days", async () => {
    await db.insert(chargerStateLog).values([
      { chargerId: "charger-1", observedAt: new Date(t0.getTime() - 31 * 86_400_000), operationMode: 1 },
      { chargerId: "charger-1", observedAt: new Date(t0.getTime() - 29 * 86_400_000), operationMode: 1 },
    ]);
    await logChargerStates([charging], t0);
    expect((await rows()).map((r) => r.operationMode)).toEqual([1, 3]);
  });
});
