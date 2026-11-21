import "server-only";
import { and, desc, eq, gt, isNotNull, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents, chargerStateLog, vehicleTelemetry, webhookEvents } from "@/lib/db/schema";
import { ActivityType } from "@/lib/activity/log";
import { getStateOfCharge } from "@/lib/smartcar/client";
import { newerReading } from "@/lib/smartcar/state";
import type { StateOfCharge } from "@/lib/smartcar/types";
import { carConnection, type CarConnection, type PlugEvent } from "./carCharger";

// Innstillinger → Bil og lader (HANDOFF §6g): reads from data the server
// already has -- the activity log, vehicle_telemetry, the Smartcar reading
// and charger_state_log. No Zaptec calls here.

/** Connected or not, from the latest plug-in/unplug lines the tick logged. */
export async function loadCarConnection(): Promise<CarConnection> {
  // The latest of each kind: repeated lines of one kind (a missed tick) can't hide the other.
  const latest = (type: string) =>
    db
      .select({ at: activityEvents.createdAt })
      .from(activityEvents)
      .where(eq(activityEvents.type, type))
      .orderBy(desc(activityEvents.createdAt))
      .limit(1)
      .then((rows) => rows[0]?.at ?? null);
  const [pluggedIn, unplugged] = await Promise.all([latest(ActivityType.PluggedIn), latest(ActivityType.Unplugged)]);
  const events: PlugEvent[] = [];
  if (pluggedIn) events.push({ type: "plugged_in", at: pluggedIn });
  if (unplugged) events.push({ type: "unplugged", at: unplugged });
  return carConnection(events);
}

/**
 * The car's battery reading as Hjem shows it: the newer of the live Smartcar
 * answer and the latest webhook row. `api` says whether Smartcar answered.
 */
export async function loadBatteryReading(): Promise<{ reading: StateOfCharge | null; api: StateOfCharge | null }> {
  const [api, [row]] = await Promise.all([
    getStateOfCharge().catch(() => null),
    db
      .select({ percent: vehicleTelemetry.batteryPercent, at: vehicleTelemetry.batteryReportedAt })
      .from(vehicleTelemetry)
      .where(and(isNotNull(vehicleTelemetry.batteryPercent), isNotNull(vehicleTelemetry.batteryReportedAt)))
      .orderBy(desc(vehicleTelemetry.batteryReportedAt))
      .limit(1),
  ]);
  const stored = row?.percent != null && row.at ? { percent: row.percent, oemUpdatedAt: row.at } : null;
  return { reading: newerReading(api, stored), api };
}

/** When Smartcar's webhook last delivered anything (null if never). */
export async function loadLastSmartcarWebhook(): Promise<Date | null> {
  const [row] = await db
    .select({ at: webhookEvents.receivedAt })
    .from(webhookEvents)
    .where(like(webhookEvents.eventType, "smartcar-%"))
    .orderBy(desc(webhookEvents.receivedAt))
    .limit(1);
  return row?.at ?? null;
}

/** The last power the charger reported above zero (charger_state_log keeps ~30 days). */
export async function loadLastObservedPower(chargerId: string): Promise<{ kw: number; at: Date } | null> {
  const [row] = await db
    .select({ kw: chargerStateLog.powerKw, at: chargerStateLog.observedAt })
    .from(chargerStateLog)
    .where(and(eq(chargerStateLog.chargerId, chargerId), gt(chargerStateLog.powerKw, "0")))
    .orderBy(desc(chargerStateLog.observedAt))
    .limit(1);
  return row?.kw != null ? { kw: Number(row.kw), at: row.at } : null;
}
