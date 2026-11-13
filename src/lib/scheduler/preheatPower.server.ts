import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { chargeSchedules, manualChargeSessions } from "@/lib/db/schema";
import type { ChargerState } from "@/lib/zaptec/types";
import { sendPushToAllSubscribers } from "@/lib/push/send";
import { preheatOnBattery } from "@/lib/push/notifications";
import { preheatPowerCheck } from "./preheatPower";

// D68, the tick's side: keep each Forvarm's "not drawing since" up to date
// and send the "på batteriet" push once. The flag is saved before the push
// goes out, so a failing push can't turn into one per tick. Never sends a
// charger command.

type PowerFields = { lostAt: Date | null; notifiedAt: Date | null };

async function check(
  chargerId: string,
  current: PowerFields,
  startedAt: Date | null,
  state: ChargerState,
  now: Date,
  save: (next: PowerFields) => Promise<void>,
): Promise<void> {
  const result = preheatPowerCheck({ state, lostAt: current.lostAt, notifiedAt: current.notifiedAt, startedAt, now });
  const next: PowerFields = { lostAt: result.lostAt, notifiedAt: result.notify ? now : current.notifiedAt };
  if (next.lostAt?.getTime() !== current.lostAt?.getTime() || next.notifiedAt?.getTime() !== current.notifiedAt?.getTime()) {
    await save(next);
  }
  if (result.notify) {
    await sendPushToAllSubscribers(preheatOnBattery({ chargerId, since: result.lostAt! })).catch(() => undefined);
  }
}

/** A Forvarm session row (kind "preheat"), while the car is connected. */
export async function checkPreheatSessionPower(
  row: typeof manualChargeSessions.$inferSelect,
  state: ChargerState,
  now: Date,
): Promise<void> {
  await check(
    row.chargerId,
    { lostAt: row.powerLostAt, notifiedAt: row.powerLostNotifiedAt },
    row.startedAt,
    state,
    now,
    (next) =>
      db
        .update(manualChargeSessions)
        .set({ powerLostAt: next.lostAt, powerLostNotifiedAt: next.notifiedAt })
        .where(eq(manualChargeSessions.id, row.id))
        .then(() => undefined),
  );
}

/** A plan / Smart row with an active Forvarm hold (D67). The car was charging when it was set. */
export async function checkHoldPower(
  schedule: typeof chargeSchedules.$inferSelect,
  state: ChargerState,
  now: Date,
): Promise<void> {
  await check(
    schedule.chargerId,
    { lostAt: schedule.preheatPowerLostAt, notifiedAt: schedule.preheatPowerLostNotifiedAt },
    null,
    state,
    now,
    (next) =>
      db
        .update(chargeSchedules)
        .set({ preheatPowerLostAt: next.lostAt, preheatPowerLostNotifiedAt: next.notifiedAt })
        .where(eq(chargeSchedules.id, schedule.id))
        .then(() => undefined),
  );
}
