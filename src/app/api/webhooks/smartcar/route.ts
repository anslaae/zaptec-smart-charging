import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { desc } from "drizzle-orm";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { webhookEvents, vehicleTelemetry } from "@/lib/db/schema";
import { computeHmac, verifySignature, parseVehicleStateSignals } from "@/lib/smartcar/webhook";
import type { SmartcarWebhookEvent } from "@/lib/smartcar/types";

// Records battery/odometer history from Smartcar's webhook (see
// HANDOVER.md's "Smartcar API reality" for why this exists -- GET requests
// to the signals API don't make Smartcar re-poll the vehicle; only a webhook
// subscription does). Mirrors the Zaptec session-end webhook's shape: log
// the raw payload, never block, never throw back at Smartcar.
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  let payload: SmartcarWebhookEvent | null = null;
  try {
    payload = JSON.parse(rawBody) as SmartcarWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!env.SMARTCAR_APPLICATION_MANAGEMENT_TOKEN) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  // The one-time VERIFY handshake, sent when the webhook is created/
  // re-verified in the Smartcar Dashboard -- answered with an HMAC of the
  // challenge itself, not the raw body, and isn't signed the way ongoing
  // deliveries are.
  if (payload.eventType === "VERIFY") {
    const challenge = (payload as { data?: { challenge?: string } }).data?.challenge;
    if (!challenge) {
      return NextResponse.json({ error: "Missing challenge" }, { status: 400 });
    }
    return NextResponse.json({
      challenge: computeHmac(challenge, env.SMARTCAR_APPLICATION_MANAGEMENT_TOKEN),
    });
  }

  const signatureHeader = request.headers.get("sc-signature");
  if (!verifySignature(rawBody, signatureHeader, env.SMARTCAR_APPLICATION_MANAGEMENT_TOKEN)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  await db.insert(webhookEvents).values({
    eventType: `smartcar-${payload.eventType}`,
    payload: payload as unknown as Record<string, unknown>,
  });

  if (payload.eventType === "VEHICLE_STATE") {
    const data = (payload as { data?: { vehicle?: { id?: string }; signals?: unknown } }).data;
    // Not this household's car (shouldn't happen with a single subscribed
    // vehicle, but cheap to check) -- still logged above, just not recorded.
    if (env.SMARTCAR_VEHICLE_ID && data?.vehicle?.id && data.vehicle.id !== env.SMARTCAR_VEHICLE_ID) {
      return NextResponse.json({ ok: true });
    }

    const parsed = parseVehicleStateSignals(
      data?.signals as Parameters<typeof parseVehicleStateSignals>[0],
    );
    if (parsed.batteryReportedAt || parsed.odometerReportedAt) {
      await recordTelemetryIfChanged(parsed);
    }
  }

  return NextResponse.json({ ok: true });
}

async function recordTelemetryIfChanged(
  parsed: ReturnType<typeof parseVehicleStateSignals>,
): Promise<void> {
  const [lastRow] = await db
    .select()
    .from(vehicleTelemetry)
    .orderBy(desc(vehicleTelemetry.createdAt))
    .limit(1);

  const batteryReportedAt = parsed.batteryReportedAt ?? lastRow?.batteryReportedAt ?? null;
  const odometerReportedAt = parsed.odometerReportedAt ?? lastRow?.odometerReportedAt ?? null;

  const batteryChanged =
    parsed.batteryReportedAt != null &&
    batteryReportedAt?.getTime() !== lastRow?.batteryReportedAt?.getTime();
  const odometerChanged =
    parsed.odometerReportedAt != null &&
    odometerReportedAt?.getTime() !== lastRow?.odometerReportedAt?.getTime();

  // Nothing new since the last stored sample -- a redelivered/retried event,
  // or a trigger that fired without either signal actually changing. This is
  // both the "scalable storage" behavior (rows only grow with real OEM
  // updates) and free idempotency against Smartcar's at-least-once delivery.
  if (!batteryChanged && !odometerChanged) return;

  await db.insert(vehicleTelemetry).values({
    batteryPercent: parsed.batteryPercent ?? lastRow?.batteryPercent ?? null,
    batteryReportedAt,
    odometerKm:
      parsed.odometerKm != null ? String(parsed.odometerKm) : (lastRow?.odometerKm ?? null),
    odometerReportedAt,
  });
}
