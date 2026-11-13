import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { chargeSchedules, manualChargeSessions, activityEvents, vehicleTelemetry } from "@/lib/db/schema";
import { saveSettings, type HouseholdSettings } from "@/lib/settings";
import { ZaptecCommand } from "@/lib/zaptec/constants";
import { HOUSEHOLD_TIME_ZONE, formatTime, tomorrowAtLocalValue, zonedDateTimeToUtc } from "@/lib/datetime";
import { ChargerSim } from "./charger";
import { MOCK_CHARGER } from "./mode";
import { MOCK_USERS } from "./seed";
import { mockLog, mockStore } from "./store";

// One-click starting points for every Hjem state (and offline). Each preset
// rebuilds the simulated charger and the open plan/manual-session rows, as if
// the household had got there for real. Past history is left alone.

export const PRESETS = {
  noCar: "Ingen bil tilkoblet",
  connected: "Tilkoblet – ingen plan",
  planWaiting: "Plan klar – venter på bilen",
  planned: "Planlagt",
  chargingPlan: "Lader etter plan",
  chargingManual: "Lad nå",
  preheating: "Forvarmer",
  ready: "Klar (plan fullført)",
  automatic: "Lader automatisk (tillatt)",
  smartWaiting: "Smart lading – venter",
  smartCharging: "Smart lading – lader",
  guestWaiting: "Lånt ut – venter på gjest",
  guestCharging: "Lånt ut – gjest lader",
  noControl: "Laderen krever innlogging",
  offline: "Laderen offline",
} as const;

export type PresetKey = keyof typeof PRESETS;

const MINUTE = 60_000;

async function clearOpenState(now: Date): Promise<void> {
  await db
    .update(chargeSchedules)
    .set({ status: "cancelled", endedAt: now, updatedAt: now })
    .where(inArray(chargeSchedules.status, ["pending", "active"]));
  await db.update(manualChargeSessions).set({ endedAt: now }).where(isNull(manualChargeSessions.endedAt));
  await setAutomatic(false);
}

async function setAutomatic(allow: boolean): Promise<void> {
  await setPluginMode(allow ? "now" : "wait");
}

async function setPluginMode(mode: "wait" | "now" | "smart", extra: Partial<HouseholdSettings> = {}): Promise<void> {
  // Through saveSettings, like the app, so unset values keep their defaults (Elvia rates).
  await saveSettings({ onPluginMode: mode, onPluginModeUntil: null, ...extra }, null);
}

function tomorrowAt(hour: number, minute: number): Date {
  return zonedDateTimeToUtc(tomorrowAtLocalValue(HOUSEHOLD_TIME_ZONE, hour, minute), HOUSEHOLD_TIME_ZONE);
}

async function insertPlan(values: Partial<typeof chargeSchedules.$inferInsert>): Promise<void> {
  await db.insert(chargeSchedules).values({
    createdByUserId: MOCK_USERS[0].id,
    chargerId: MOCK_CHARGER.id,
    chargerName: MOCK_CHARGER.name,
    targetEnergyKwh: "15.6",
    readyBy: tomorrowAt(7, 30),
    status: "pending",
    // Like a plan made in the plan sheet: 46 % -> 80 % of a 46 kWh battery.
    startPercent: 46,
    targetPercent: 80,
    ...values,
  });
}

async function openManualSession(
  kind: "manual" | "preheat" | "guest" | "automatic",
  startedAt: Date,
  zaptecSessionId: string | null = null,
): Promise<void> {
  await db.insert(manualChargeSessions).values({
    chargerId: MOCK_CHARGER.id,
    kind,
    startedByUserId: kind === "automatic" ? null : MOCK_USERS[0].id,
    startedAt,
    zaptecSessionId,
    startEnergyKwh: zaptecSessionId ? "0.00" : null,
    lastObservedEnergyKwh: zaptecSessionId ? "0.00" : null,
  });
  if (kind === "automatic") return;
  await db.insert(activityEvents).values({
    chargerId: MOCK_CHARGER.id,
    chargerName: MOCK_CHARGER.name,
    type: { manual: "manual_start", preheat: "preheat_started", guest: "guest_started" }[kind],
    userId: MOCK_USERS[0].id,
    createdAt: startedAt,
  });
}

export async function applyPreset(key: PresetKey): Promise<void> {
  const now = new Date();
  const store = mockStore();
  const keep = store.sim.settings;
  // A fresh simulated charger each time, keeping the panel's choices
  // (power, speed, command delay, warning) -- a scenario sets up the car and
  // plans, not how the test charger behaves. The command delay is switched on
  // only after the setup, whose own commands (plug in + stop) take effect now.
  const sim = new ChargerSim(now, {
    powerKw: keep.powerKw,
    speed: keep.speed,
    capacityKwh: keep.capacityKwh,
    warnings: keep.warnings,
  });
  store.sim = sim;
  await clearOpenState(now);

  // Plug in and stop, the way free charging + enforcement leaves a plugged-in car.
  const plugInStopped = (battery: number) => {
    sim.setBattery(battery, now);
    sim.plugIn(now);
    sim.command(ZaptecCommand.StopChargingFinal, now);
  };

  switch (key) {
    case "noCar": {
      // Unplugged 26 h ago at 80 % and driven 41 km since: feeds "Koblet fra"
      // (battery −18 %, ca. 41 km, always one midnight on the line).
      // A reading just before the unplug is the baseline for both figures.
      sim.setBattery(62, now);
      const unplugged = new Date(now.getTime() - 26 * 60 * MINUTE);
      const [lastOdo] = await db
        .select({ km: vehicleTelemetry.odometerKm })
        .from(vehicleTelemetry)
        .where(isNotNull(vehicleTelemetry.odometerKm))
        .orderBy(desc(vehicleTelemetry.createdAt))
        .limit(1);
      const odo = Number(lastOdo?.km ?? 18300);
      const readings: [Date, number, number][] = [
        [new Date(unplugged.getTime() - MINUTE), 80, odo],
        [new Date(now.getTime() - 10 * 60 * MINUTE), 72, odo + 20],
        [new Date(now.getTime() - MINUTE), 62, odo + 41],
      ];
      sim.reading = { percent: 62, at: readings[2][0] };
      // This unplug must be the latest one (the seed and earlier scenarios log newer ones).
      await db
        .delete(activityEvents)
        .where(and(eq(activityEvents.type, "unplugged"), gt(activityEvents.createdAt, unplugged)));
      await db.insert(activityEvents).values({
        chargerId: MOCK_CHARGER.id,
        chargerName: MOCK_CHARGER.name,
        type: "unplugged",
        createdAt: unplugged,
      });
      await db.insert(vehicleTelemetry).values(
        readings.map(([at, percent, km]) => ({
          batteryPercent: percent,
          batteryReportedAt: at,
          odometerKm: km.toFixed(1),
          odometerReportedAt: at,
          createdAt: at,
        })),
      );
      break;
    }
    case "connected":
      plugInStopped(46);
      break;
    case "planWaiting":
      sim.setBattery(46, now);
      await insertPlan({});
      break;
    case "planned":
      plugInStopped(46);
      await insertPlan({});
      break;
    case "chargingPlan": {
      sim.setBattery(46, now);
      sim.plugIn(now);
      sim.addEnergy(3.5);
      sim.chargingSeconds = 30 * 60;
      await insertPlan({
        status: "active",
        readyBy: new Date(now.getTime() + 3 * 60 * MINUTE),
        startedAt: new Date(now.getTime() - 30 * MINUTE),
        lastCommand: "resume",
        zaptecSessionId: sim.sessionId,
        priorSessionEnergyKwh: "0",
        lastObservedSessionEnergyKwh: "3.5",
        remainingKwhAtStart: "15.6",
      });
      break;
    }
    case "chargingManual":
      sim.setBattery(55, now);
      sim.plugIn(now);
      await openManualSession("manual", new Date(now.getTime() - 2 * MINUTE));
      break;
    case "preheating":
      sim.settings.powerKw = 2.3;
      sim.setBattery(78, now);
      sim.plugIn(now);
      await openManualSession("preheat", new Date(now.getTime() - 3 * MINUTE));
      break;
    case "ready": {
      plugInStopped(80);
      sim.reading = { percent: 80, at: new Date(now.getTime() - 10 * MINUTE) };
      await insertPlan({
        status: "completed",
        readyBy: new Date(now.getTime() + 60 * MINUTE),
        startedAt: new Date(now.getTime() - 4 * 60 * MINUTE),
        endedAt: new Date(now.getTime() - 15 * MINUTE),
        lastCommand: "stop",
        lastNote: "Target energy reached",
        zaptecSessionId: sim.sessionId,
      });
      break;
    }
    case "automatic":
      await setAutomatic(true);
      sim.setBattery(50, now);
      sim.plugIn(now);
      await openManualSession("automatic", new Date(now.getTime() - MINUTE), sim.sessionId);
      break;
    case "smartWaiting": {
      // Smart lading on, car plugged in: a real tick lets the planner make the row
      // (and send smart_planned), exactly like a plug-in at home.
      // Ready ~14 h from now on any day, so there's always a cheap window to wait for.
      const readyAt = formatTime(new Date(Math.round((now.getTime() + 14 * 60 * MINUTE) / (15 * MINUTE)) * 15 * MINUTE));
      await setPluginMode("smart", { smartTargetPercent: 80, smartReadyByWeekday: readyAt, smartReadyByWeekend: readyAt });
      plugInStopped(46);
      sim.reading = { percent: 46, at: new Date(now.getTime() - 20 * MINUTE) };
      const { runSchedulerTick } = await import("@/lib/scheduler/run");
      await runSchedulerTick();
      break;
    }
    case "smartCharging": {
      // Inside its planned block right now.
      await setPluginMode("smart");
      sim.setBattery(55, now);
      sim.plugIn(now);
      sim.addEnergy(4);
      sim.chargingSeconds = 35 * 60;
      sim.reading = { percent: 46, at: new Date(now.getTime() - 60 * MINUTE) };
      await db.insert(chargeSchedules).values({
        createdByUserId: null,
        source: "smart",
        chargerId: MOCK_CHARGER.id,
        chargerName: MOCK_CHARGER.name,
        targetEnergyKwh: "15.6",
        readyBy: new Date(now.getTime() + 3 * 60 * MINUTE),
        status: "active",
        startedAt: new Date(now.getTime() - 35 * MINUTE),
        lastCommand: "resume",
        startPercent: 46,
        targetPercent: 80,
        zaptecSessionId: sim.sessionId,
        priorSessionEnergyKwh: "0",
        lastObservedSessionEnergyKwh: "4",
        blocks: {
          blocks: [
            { start: new Date(now.getTime() - 35 * MINUTE).toISOString(), end: new Date(now.getTime() + 100 * MINUTE).toISOString() },
          ],
          powerKw: 7,
          costNok: 12.7,
          nowCostNok: 14.4,
          late: false,
          plannedAt: new Date(now.getTime() - 40 * MINUTE).toISOString(),
        },
      });
      break;
    }
    case "guestWaiting":
      await openManualSession("guest", new Date(now.getTime() - 5 * MINUTE));
      break;
    case "guestCharging":
      sim.settings.powerKw = 11;
      sim.setBattery(30, now);
      sim.plugIn(now);
      await openManualSession("guest", new Date(now.getTime() - 20 * MINUTE), sim.sessionId);
      break;
    case "noControl":
      sim.settings.requiresAuth = true;
      sim.setBattery(46, now);
      sim.plugIn(now);
      break;
    case "offline":
      sim.settings.online = false;
      break;
  }
  sim.reading ??= { percent: Math.round(sim.batteryPercent), at: new Date(now.getTime() - 40 * MINUTE) };
  sim.settings.commandLagSeconds = keep.commandLagSeconds;
  mockLog("info", `Scenario: ${PRESETS[key]}`);
}
