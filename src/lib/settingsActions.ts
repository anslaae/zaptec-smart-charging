"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/dal";
import { afterPluginModeChange, getSettings, saveSettings } from "@/lib/settings";
import { HOUSEHOLD_TIME_ZONE, tomorrowAtLocalValue, zonedDateTimeToUtc } from "@/lib/datetime";
import { sendPushToUser } from "@/lib/push/send";
import { nb } from "@/lib/i18n/nb";
import { isHhmm } from "@/lib/scheduler/smart";

export interface SettingsResult {
  error?: string;
  success?: boolean;
  /** setOnPluginMode: when it falls back to "wait" (null = until changed). */
  untilIso?: string | null;
}

const OnPluginSchema = z.object({
  mode: z.enum(["wait", "now", "smart"]),
  /** "tomorrow" = until 08:00 tomorrow (Oslo), "off" = until changed, "keep" = unchanged (HANDOFF §3b). Ignored for "wait". */
  duration: z.enum(["tomorrow", "off", "keep"]).default("off"),
  smartTargetPercent: z.union([z.literal(70), z.literal(80), z.literal(90), z.literal(100)]).optional(),
  smartReadyByWeekday: z.string().refine(isHhmm).optional(),
  smartReadyByWeekend: z.string().refine(isHhmm).optional(),
});

/**
 * Innstillinger → "Når bilen kobles til" (HANDOFF §6b): wait / now / smart,
 * with the smart target and ready-by times. "now" and "smart" let anyone at
 * the charger charge, so the UI asks first and passes a duration.
 */
export async function setOnPluginMode(input: z.input<typeof OnPluginSchema>): Promise<SettingsResult> {
  const session = await verifySession();
  const parsed = OnPluginSchema.safeParse(input);
  if (!parsed.success) return { error: nb.settings.charging.saveFailed };
  const { mode, duration, ...smart } = parsed.data;
  const current = await getSettings();
  const previous = current.onPluginMode;
  const until =
    mode === "wait" ? null : duration === "tomorrow" ? tomorrowAt0800() : duration === "keep" ? current.onPluginModeUntil : null;
  await saveSettings(
    {
      onPluginMode: mode,
      onPluginModeUntil: until,
      ...(smart.smartTargetPercent != null && { smartTargetPercent: smart.smartTargetPercent }),
      ...(smart.smartReadyByWeekday && { smartReadyByWeekday: smart.smartReadyByWeekday }),
      ...(smart.smartReadyByWeekend && { smartReadyByWeekend: smart.smartReadyByWeekend }),
    },
    session.userId,
  );
  await afterPluginModeChange(previous, mode, session.userId);
  revalidatePath("/", "layout");
  return { success: true, untilIso: until?.toISOString() ?? null };
}

function tomorrowAt0800(): Date {
  return zonedDateTimeToUtc(tomorrowAtLocalValue(HOUSEHOLD_TIME_ZONE, 8, 0), HOUSEHOLD_TIME_ZONE);
}


const PriceSchema = z.coerce.number().min(0).max(20);

export async function setEnergyPrice(_prev: SettingsResult, formData: FormData): Promise<SettingsResult> {
  const session = await verifySession();
  // Accept "0,50" as typed on a Norwegian keyboard.
  const raw = String(formData.get("price") ?? "").replace(",", ".").trim();
  const parsed = PriceSchema.safeParse(raw);
  if (!raw || !parsed.success) return { error: nb.settings.price.invalid };
  await saveSettings({ energyPriceNokPerKwh: parsed.data }, session.userId);
  revalidatePath("/", "layout");
  return { success: true };
}

// Nettleie energiledd (D30): both rates or neither.
export async function setGridTariff(_prev: SettingsResult, formData: FormData): Promise<SettingsResult> {
  const session = await verifySession();
  const read = (name: string) => String(formData.get(name) ?? "").replace(",", ".").trim();
  const day = read("gridDay");
  const night = read("gridNight");
  if (!day && !night) {
    await saveSettings({ gridDayNokPerKwh: null, gridNightNokPerKwh: null }, session.userId);
  } else {
    const d = PriceSchema.safeParse(day);
    const n = PriceSchema.safeParse(night);
    if (!day || !night || !d.success || !n.success) return { error: nb.settings.price.gridInvalid };
    await saveSettings({ gridDayNokPerKwh: d.data, gridNightNokPerKwh: n.data }, session.userId);
  }
  revalidatePath("/", "layout");
  return { success: true };
}

// UC12: sends to the signed-in person's own devices only.
export async function sendTestNotification(): Promise<SettingsResult> {
  const session = await verifySession();
  const { devices } = await sendPushToUser(session.userId, {
    title: nb.notifications.test.title,
    body: nb.notifications.test.body,
    tag: "test",
    url: "/settings",
  });
  if (devices === 0) return { error: nb.settings.notifications.testNoDevice };
  return { success: true };
}
