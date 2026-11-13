"use server";

import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { createSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { computeHmac } from "@/lib/smartcar/webhook";
import { STATE_OF_CHARGE_SIGNAL, ODOMETER_SIGNAL } from "@/lib/smartcar/constants";
import { ChargerSim } from "./charger";
import { MOCK_CHARGER, MOCK_MODE } from "./mode";
import { MOCK_USERS } from "./seed";
import { applyPreset, PRESETS, type PresetKey } from "./presets";
import { resetMockDb } from "./db";
import { mockLog, mockStore } from "./store";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { chargeSchedules } from "@/lib/db/schema";
import { planDeliveredNow } from "@/lib/scheduler/engine";

// Server actions behind the /dev/mock control panel. Every one refuses to run
// outside mock mode, so they can't touch real data even if called directly.

function requireMock(): void {
  if (!MOCK_MODE) throw new Error("Only available in mock mode (npm run dev:mock).");
}

async function guard(): Promise<void> {
  requireMock();
  await verifySession();
}

const BASE = "http://localhost:3100";

export type SimAction =
  | { type: "plugIn" }
  | { type: "unplug" }
  | { type: "authorise" }
  | { type: "reportBattery" }
  | { type: "setBattery"; percent: number }
  | { type: "addEnergy"; kwh: number }
  | { type: "setPower"; kw: number }
  | { type: "carStopsDrawing" }
  | { type: "carDrawsAgain" }
  | { type: "carIdlesWhileCharging" }
  | { type: "setSpeed"; speed: number }
  | { type: "setRequiresAuth"; value: boolean }
  | { type: "setOnline"; value: boolean }
  | { type: "setSmartcarDown"; value: boolean };

export async function mockSim(action: SimAction): Promise<void> {
  await guard();
  const { sim } = mockStore();
  const now = new Date();
  switch (action.type) {
    case "plugIn":
      sim.plugIn(now);
      mockLog("info", "Bil koblet til");
      break;
    case "unplug":
      sim.unplug(now);
      mockLog("info", "Bil koblet fra");
      break;
    case "authorise":
      sim.authorise(now);
      mockLog("info", "RFID/Zaptec-app autoriserte økten");
      break;
    case "reportBattery":
      sim.reportBattery(now);
      mockLog("info", `Bilen rapporterte ${sim.reading?.percent} % til Smartcar`);
      break;
    case "setBattery":
      sim.setBattery(action.percent, now);
      break;
    case "addEnergy":
      sim.advance(now);
      sim.addEnergy(action.kwh);
      break;
    case "carStopsDrawing":
      sim.carStopsDrawing(now);
      mockLog("info", "Bilen sluttet å trekke strøm (modus 5)");
      break;
    case "carIdlesWhileCharging":
      sim.carIdlesWhileCharging(now);
      mockLog("info", "Bilen trekker 0 A, laderen står fortsatt i modus 3");
      break;
    case "carDrawsAgain":
      sim.carDrawsAgain(now);
      mockLog("info", "Bilen trekker strøm igjen");
      break;
    case "setPower":
      sim.advance(now);
      sim.settings.powerKw = action.kw;
      break;
    case "setSpeed":
      sim.advance(now);
      sim.settings.speed = action.speed;
      break;
    case "setRequiresAuth":
      sim.settings.requiresAuth = action.value;
      break;
    case "setOnline":
      sim.settings.online = action.value;
      break;
    case "setSmartcarDown":
      sim.settings.smartcarDown = action.value;
      break;
  }
  revalidatePath("/", "layout");
}

export async function mockApplyPreset(key: PresetKey): Promise<void> {
  await guard();
  if (!(key in PRESETS)) throw new Error(`Unknown preset ${key}`);
  await applyPreset(key);
  revalidatePath("/", "layout");
}

export async function mockResetAll(): Promise<void> {
  await guard();
  const store = mockStore();
  store.sim = new ChargerSim(new Date());
  store.log = [];
  await resetMockDb();
  mockLog("info", "Alt nullstilt til startdata");
  revalidatePath("/", "layout");
}

async function callRoute(
  label: string,
  handler: (request: NextRequest) => Promise<Response>,
  path: string,
  init: ConstructorParameters<typeof NextRequest>[1],
): Promise<string> {
  const response = await handler(new NextRequest(`${BASE}${path}`, init));
  const body = await response.text();
  const summary = `${label}: ${response.status} ${body.slice(0, 160)}`;
  mockLog("incoming", summary);
  revalidatePath("/", "layout");
  return summary;
}

/** What cron-job.org does every minute: GET /api/cron/tick with the bearer secret. */
export async function mockCronTick(): Promise<string> {
  await guard();
  const { GET } = await import("@/app/api/cron/tick/route");
  return callRoute("Cron-tick", GET, "/api/cron/tick", {
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  });
}

/**
 * Jumps a charging plan to its finish: adds the energy it still needs to the
 * simulated session, then runs a real cron tick, which sees the target
 * reached, sends the final stop and the "Bilen er klar" push, and marks the
 * plan completed -- exactly what happens at the end of a real plan. (The
 * Zaptec session-end webhook doesn't do this: it only records the session's
 * energy after the car is unplugged.)
 */
export async function mockFinishPlan(): Promise<string> {
  await guard();
  const { sim } = mockStore();
  const now = new Date();
  const [plan] = await db
    .select()
    .from(chargeSchedules)
    .where(and(eq(chargeSchedules.chargerId, MOCK_CHARGER.id), inArray(chargeSchedules.status, ["pending", "active"])))
    .limit(1);
  if (!plan || !sim.carConnected) {
    mockLog("info", "Fullfør plan: ingen plan med bilen tilkoblet");
    return "Ingen plan med bilen tilkoblet";
  }
  sim.advance(now);
  const delivered = planDeliveredNow(
    {
      zaptecSessionId: plan.zaptecSessionId,
      priorSessionEnergyKwh: Number(plan.priorSessionEnergyKwh ?? 0),
      lastObservedSessionEnergyKwh: Number(plan.lastObservedSessionEnergyKwh ?? 0),
    },
    sim.toChargerState(MOCK_CHARGER.id, now),
  );
  const remaining = Math.max(0, Number(plan.targetEnergyKwh) - delivered);
  sim.addEnergy(remaining + 0.05);
  mockLog("info", `Fullfør plan: +${remaining.toFixed(1)} kWh lagt til økten`);
  return mockCronTick();
}

/** Zaptec's session-end webhook for the last completed session (Basic auth). */
export async function mockZaptecSessionEnd(): Promise<string> {
  await guard();
  const { sim } = mockStore();
  const last = sim.lastCompletedSession;
  const payload = {
    ChargerId: MOCK_CHARGER.id,
    SessionId: sim.history[0]?.id ?? null,
    Energy: last?.energyKwh ?? 0,
    StartDateTime: last?.startedAt ?? new Date().toISOString(),
    EndDateTime: last?.endedAt ?? new Date().toISOString(),
  };
  const auth = Buffer.from(`${env.ZAPTEC_WEBHOOK_USERNAME}:${env.ZAPTEC_WEBHOOK_PASSWORD}`).toString("base64");
  const { POST } = await import("@/app/api/webhooks/zaptec/session-end/route");
  return callRoute("Zaptec session-end", POST, "/api/webhooks/zaptec/session-end", {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Smartcar's VEHICLE_STATE webhook: the car reports now, signed like Smartcar signs it. */
export async function mockSmartcarWebhook(): Promise<string> {
  await guard();
  const { sim } = mockStore();
  const now = new Date();
  sim.reportBattery(now);
  const rawBody = JSON.stringify({
    eventType: "VEHICLE_STATE",
    data: {
      vehicle: { id: env.SMARTCAR_VEHICLE_ID },
      signals: [
        {
          code: STATE_OF_CHARGE_SIGNAL,
          body: { value: sim.reading?.percent ?? Math.round(sim.batteryPercent) },
          status: { value: "SUCCESS" },
          meta: { oemUpdatedAt: now.toISOString() },
        },
        {
          code: ODOMETER_SIGNAL,
          body: { value: 36650.5 },
          status: { value: "SUCCESS" },
          meta: { oemUpdatedAt: now.toISOString() },
        },
      ],
    },
  });
  const signature = computeHmac(rawBody, env.SMARTCAR_APPLICATION_MANAGEMENT_TOKEN!);
  const { POST } = await import("@/app/api/webhooks/smartcar/route");
  return callRoute("Smartcar webhook", POST, "/api/webhooks/smartcar", {
    method: "POST",
    headers: { "sc-signature": signature, "content-type": "application/json" },
    body: rawBody,
  });
}

/** What the uptime monitor does: GET /api/health. */
export async function mockHealthCheck(): Promise<string> {
  await guard();
  const { GET } = await import("@/app/api/health/route");
  return callRoute("Helsesjekk", () => GET(), "/api/health", {});
}

/** One-click login on /login in mock mode. */
export async function mockLogin(userId: string): Promise<void> {
  requireMock();
  if (!MOCK_USERS.some((u) => u.id === userId)) throw new Error("Unknown mock user");
  await createSession(userId);
  redirect("/");
}
