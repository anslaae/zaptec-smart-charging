import { beforeEach, describe, expect, it, vi } from "vitest";

// The whole tick (runSchedulerTick) against the mock charger, Smartcar and
// in-memory database (MOCK_MODE): proves D86/D87 end to end and, above all,
// that flapping, old or repeated battery readings never make the tick send
// start/stop commands on its own (D64/D65 loop history).
vi.hoisted(() => {
  process.env.MOCK_MODE = "1";
});
vi.mock("server-only", () => ({}));

const t0 = new Date("2026-11-20T21:00:00Z");
vi.useFakeTimers({ toFake: ["Date"], now: t0 });

const { mockStore } = await import("@/lib/mock/store");
const { ChargerSim } = await import("@/lib/mock/charger");
const { MOCK_CHARGER } = await import("@/lib/mock/mode");
const { db } = await import("@/lib/db");
const schema = await import("@/lib/db/schema");
const { saveSettings } = await import("@/lib/settings");
const { ZaptecCommand } = await import("@/lib/zaptec/constants");
const { runSchedulerTick } = await import("./run");
const { resetLearnedPowerCache } = await import("./powerHistory.server");
const { resetKwhPerPercentCache } = await import("./socTarget.server");

let now = t0;
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
async function tick(minutes = 1): Promise<void> {
  now = at(minutes);
  vi.setSystemTime(now);
  await runSchedulerTick();
}
// mockLog keeps newest first; oldest first here.
const log = () => [...mockStore().log].reverse();
const commands = () => log().filter((e) => e.kind === "command").map((e) => e.text);
const pushes = () => log().filter((e) => e.kind === "push").map((e) => e.text);
const sim = () => mockStore().sim;
const plan = async () => (await db.select().from(schema.chargeSchedules))[0];

beforeEach(async () => {
  now = t0;
  vi.setSystemTime(now);
  const store = mockStore();
  store.sim = new ChargerSim(now, {}, 50);
  // Clean slate: no seed history (it would feed the learned kWh/% and power).
  await db.delete(schema.scheduleActions);
  await db.delete(schema.chargeSchedules);
  await db.delete(schema.manualChargeSessions);
  await db.delete(schema.vehicleTelemetry);
  await db.delete(schema.chargerStateLog);
  await db.delete(schema.chargerObservedState);
  await db.delete(schema.chargeIncidents);
  await db.delete(schema.pushLog);
  await saveSettings({ onPluginMode: "wait", onPluginModeUntil: null }, null);
  resetLearnedPowerCache();
  resetKwhPerPercentCache();
  // Plugged in and latched off (as enforcement leaves a car), before the plan.
  sim().plugIn(now);
  sim().command(ZaptecCommand.StopChargingFinal, now);
  sim().reading = { percent: 50, at: at(-30) };
  await runSchedulerTick(); // first observation of the charger
  store.log.length = 0;
});

async function insertUserPlan(values: Partial<typeof schema.chargeSchedules.$inferInsert> = {}) {
  await db.insert(schema.chargeSchedules).values({
    chargerId: MOCK_CHARGER.id,
    chargerName: MOCK_CHARGER.name,
    targetEnergyKwh: "13.80",
    readyBy: at(60), // already past the latest start: it starts at once
    status: "pending",
    startPercent: 50,
    targetPercent: 80,
    ...values,
  });
}

describe("D86 through the tick: user plan", () => {
  it("flapping, old and repeated readings: one start, rate-limited retargets, one final stop at a reading >= target", async () => {
    await insertUserPlan();
    await tick();
    expect(commands()).toEqual([expect.stringContaining("ResumeCharging")]);
    const startedAt = (await plan()).startedAt!;
    expect(startedAt).toEqual(now);

    const targets = new Set<string>();
    // 5 ticks with a reading from before the start (old), then 30 ticks of a
    // new reading every minute flapping 51 % / 70 %, and some repeats.
    for (let i = 0; i < 35; i++) {
      if (i < 5) sim().reading = { percent: 40, at: new Date(startedAt.getTime() - 30 * 60_000) };
      else if (i % 7 === 0) {
        /* repeated identical reading: leave it */
      } else sim().reading = { percent: i % 2 ? 51 : 70, at: at(0.5) };
      await tick();
      targets.add((await plan()).targetEnergyKwh);
    }
    // Still the single start; nothing paused, nothing stopped.
    expect(commands()).toHaveLength(1);
    expect((await plan()).status).toBe("active");
    // Target moved at most once per 10 min (35 min of ticks -> at most 4 values incl. the original).
    expect(targets.size).toBeLessThanOrEqual(4);
    expect(targets.size).toBeGreaterThan(1); // the drift correction did act

    // The car reports 81 %: one final stop, plan completed, the push states the reading.
    sim().reading = { percent: 81, at: at(0.5) };
    await tick();
    for (let i = 0; i < 5; i++) await tick(); // same reading again: nothing more
    expect(commands()).toHaveLength(2);
    expect(commands()[1]).toContain("StopChargingFinal");
    expect((await plan()).status).toBe("completed");
    expect(pushes().filter((p) => p.includes("Bilen er klar"))).toHaveLength(1);
    expect(pushes().find((p) => p.includes("Bilen er klar"))).toContain("Bilen meldte 81 %");
  });

  it("a reading at the target from before charging started never completes the plan", async () => {
    await insertUserPlan();
    sim().reading = { percent: 85, at: at(0.5) }; // taken before the first resume (next tick)
    await tick();
    for (let i = 0; i < 5; i++) await tick();
    expect(commands()).toEqual([expect.stringContaining("ResumeCharging")]);
    expect((await plan()).status).toBe("active");
  });
});

describe("D87 through the tick: Smart row", () => {
  it("first resume sends smart_started once; completion sends plan_completed", async () => {
    await saveSettings({ onPluginMode: "smart", onPluginModeUntil: null }, null);
    const session = sim().sessionId!;
    const kwhNow = sim().sessionEnergyKwh;
    await db.insert(schema.chargeSchedules).values({
      source: "smart",
      chargerId: MOCK_CHARGER.id,
      chargerName: MOCK_CHARGER.name,
      targetEnergyKwh: "0.50",
      readyBy: at(8 * 60),
      status: "pending",
      startPercent: 50,
      targetPercent: 80,
      blocks: {
        blocks: [{ start: at(0).toISOString(), end: at(120).toISOString() }],
        powerKw: 7.1,
        costNok: 5,
        nowCostNok: 6,
        late: false,
        plannedAt: at(0).toISOString(),
      },
      zaptecSessionId: session,
      priorSessionEnergyKwh: (-kwhNow).toString(),
      lastObservedSessionEnergyKwh: kwhNow.toString(),
    });
    await tick();
    expect(commands()).toEqual([expect.stringContaining("ResumeCharging")]);
    const started = pushes().filter((p) => p.includes("Smart lading har startet"));
    expect(started).toHaveLength(1);
    expect(started[0]).toContain("Lader til 80 %, ferdig ca.");

    for (let i = 0; i < 6; i++) await tick(); // 7.1 kW: 0.5 kWh in ~4 min
    expect((await plan()).status).toBe("completed");
    expect(pushes().filter((p) => p.includes("Smart lading har startet"))).toHaveLength(1);
    const done = pushes().filter((p) => p.includes("Bilen er klar"));
    expect(done).toHaveLength(1);
    expect(done[0]).toContain(`[tag plan-${(await plan()).id}]`);
    expect(commands().filter((c) => c.includes("StopChargingFinal"))).toHaveLength(1);

    // D87: each push has its push_log row.
    const logged = await db.select().from(schema.pushLog);
    expect(logged.map((r) => r.event)).toEqual(expect.arrayContaining(["smart_started", "plan_completed"]));
  });
});
