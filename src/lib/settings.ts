import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { chargeSchedules, manualChargeSessions, settings } from "@/lib/db/schema";
import { nb } from "@/lib/i18n/nb";
import { ZaptecCommand } from "@/lib/zaptec/constants";
import { logActivity, ActivityType } from "@/lib/activity/log";
import { listChargers, sendChargerCommand } from "@/lib/zaptec/client";
import { closeSession } from "@/lib/sessions";
import type { Prices } from "@/lib/pricing";

// Household-wide settings (one row, "singleton"). Reads fall back to these
// defaults until someone saves in Innstillinger, so a fresh database needs no
// seed row and today's behaviour is the default (automatic charging off).

/**
 * What happens on plug-in when no plan, Lad nå, Forvarm or guest window
 * applies (HANDOFF §6b): wait for a plan (enforcement stops the car), charge
 * at once ("Automatisk", UC14), or Smart lading (UC16).
 */
export type OnPluginMode = "wait" | "now" | "smart";
export const ON_PLUGIN_MODES: readonly OnPluginMode[] = ["wait", "now", "smart"];

export interface HouseholdSettings {
  onPluginMode: OnPluginMode;
  /** When "now"/"smart" falls back to "wait"; null = until someone changes it. */
  onPluginModeUntil: Date | null;
  smartTargetPercent: number;
  /** "HH:MM" Oslo time; weekend also applies on public holidays. */
  smartReadyByWeekday: string;
  smartReadyByWeekend: string;
  energyPriceModel: "norgespris";
  /** kr/kWh incl. VAT used for every cost figure. */
  energyPriceNokPerKwh: number;
  /** Nettleie energiledd, weekdays 06-22 / nights + weekends (src/lib/pricing.ts); null = not set. */
  gridDayNokPerKwh: number | null;
  gridNightNokPerKwh: number | null;
}

export const DEFAULT_SETTINGS: HouseholdSettings = {
  onPluginMode: "wait",
  onPluginModeUntil: null,
  smartTargetPercent: 80,
  smartReadyByWeekday: "07:30",
  smartReadyByWeekend: "10:00",
  energyPriceModel: "norgespris",
  // Norgespris 1 Oct 2025 – 31 Dec 2026: 40 øre/kWh ex VAT = 50 øre with 25 % VAT (regjeringen.no).
  energyPriceNokPerKwh: 0.5,
  // Elvia energiledd from 1 Jul 2026, incl. fees and VAT (HANDOFF §6b): 46,40 øre
  // weekdays 06-22, 31,40 øre at night, weekends and public holidays.
  gridDayNokPerKwh: 0.464,
  gridNightNokPerKwh: 0.314,
};

export function pricesOf(settings: HouseholdSettings): Prices {
  return {
    energyNokPerKwh: settings.energyPriceNokPerKwh,
    gridDayNokPerKwh: settings.gridDayNokPerKwh,
    gridNightNokPerKwh: settings.gridNightNokPerKwh,
  };
}

const SINGLETON = "singleton";

export async function getSettings(): Promise<HouseholdSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, SINGLETON)).limit(1);
  if (!row) return DEFAULT_SETTINGS;
  return {
    onPluginMode: (ON_PLUGIN_MODES as readonly string[]).includes(row.onPluginMode)
      ? (row.onPluginMode as OnPluginMode)
      : "wait",
    onPluginModeUntil: row.onPluginModeUntil,
    smartTargetPercent: row.smartTargetPercent,
    smartReadyByWeekday: row.smartReadyByWeekday,
    smartReadyByWeekend: row.smartReadyByWeekend,
    energyPriceModel: "norgespris",
    energyPriceNokPerKwh: Number(row.energyPriceNokPerKwh),
    gridDayNokPerKwh: row.gridDayNokPerKwh == null ? null : Number(row.gridDayNokPerKwh),
    gridNightNokPerKwh: row.gridNightNokPerKwh == null ? null : Number(row.gridNightNokPerKwh),
  };
}

/** The plug-in mode in force now: "now"/"smart" past their end time count as "wait". */
export function effectivePluginMode(settings: HouseholdSettings, now: Date = new Date()): OnPluginMode {
  if (settings.onPluginMode === "wait") return "wait";
  if (settings.onPluginModeUntil != null && settings.onPluginModeUntil.getTime() <= now.getTime()) return "wait";
  return settings.onPluginMode;
}

export async function saveSettings(patch: Partial<HouseholdSettings>, userId: string | null): Promise<HouseholdSettings> {
  const next = { ...(await getSettings()), ...patch };
  const values = {
    id: SINGLETON,
    onPluginMode: next.onPluginMode,
    onPluginModeUntil: next.onPluginModeUntil,
    smartTargetPercent: next.smartTargetPercent,
    smartReadyByWeekday: next.smartReadyByWeekday,
    smartReadyByWeekend: next.smartReadyByWeekend,
    energyPriceModel: next.energyPriceModel,
    energyPriceNokPerKwh: next.energyPriceNokPerKwh.toFixed(3),
    gridDayNokPerKwh: next.gridDayNokPerKwh == null ? null : next.gridDayNokPerKwh.toFixed(3),
    gridNightNokPerKwh: next.gridNightNokPerKwh == null ? null : next.gridNightNokPerKwh.toFixed(3),
    updatedAt: new Date(),
    updatedByUserId: userId,
  };
  await db.insert(settings).values(values).onConflictDoUpdate({ target: settings.id, set: values });
  return next;
}

/**
 * After the plug-in mode changes (or expires): log it per charger, close
 * open automatic sessions when leaving "now" (enforcement then stops the
 * car, D11), and cancel open Smart lading rows when leaving "smart".
 */
export async function afterPluginModeChange(
  previous: OnPluginMode,
  next: OnPluginMode,
  userId: string | null,
  expired = false,
): Promise<void> {
  if (previous === next) return;
  const chargers = await listChargers().catch(() => []);
  const detail = nb.onPlugin[next].title + (expired ? ` (${nb.onPlugin.expired})` : "");
  for (const charger of chargers) {
    await logActivity(charger.id, charger.name, ActivityType.OnPluginModeChanged, { userId: userId ?? undefined, detail });
  }
  if (previous === "now") {
    const open = await db
      .select()
      .from(manualChargeSessions)
      .where(and(eq(manualChargeSessions.kind, "automatic"), isNull(manualChargeSessions.endedAt)));
    for (const row of open) await closeSession(row);
  }
  if (previous === "smart") {
    const now = new Date();
    const open = await db
      .select()
      .from(chargeSchedules)
      .where(and(eq(chargeSchedules.source, "smart"), inArray(chargeSchedules.status, ["pending", "active"])));
    for (const row of open) {
      await db
        .update(chargeSchedules)
        .set({ status: "cancelled", endedAt: now, updatedAt: now })
        .where(eq(chargeSchedules.id, row.id));
      // Switching to "Lad med en gang" keeps it charging (the tick opens an
      // automatic session); to "wait" it stops.
      if (row.status === "active" && next !== "now") {
        await sendChargerCommand(row.chargerId, ZaptecCommand.StopChargingFinal).catch(() => undefined);
      }
    }
  }
}
