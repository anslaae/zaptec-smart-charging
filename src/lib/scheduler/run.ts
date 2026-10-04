import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { chargeSchedules } from "@/lib/db/schema";
import { listChargers, getChargerState, sendChargerCommand } from "@/lib/zaptec/client";
import { ZaptecCommand } from "@/lib/zaptec/constants";
import type { ChargerState } from "@/lib/zaptec/types";
import { decideNextAction } from "./engine";

export async function runSchedulerTick(): Promise<{ processed: number }> {
  const tickStartedAt = new Date().toISOString();
  const schedules = await db
    .select()
    .from(chargeSchedules)
    .where(inArray(chargeSchedules.status, ["pending", "active"]));

  console.log(
    `[scheduler] tick at ${tickStartedAt}: ${schedules.length} pending/active schedule(s)`,
  );

  if (schedules.length === 0) {
    return { processed: 0 };
  }

  const chargers = await listChargers();
  const onlineByChargerId = new Map(chargers.map((charger) => [charger.id, charger.isOnline]));
  const stateCache = new Map<string, ChargerState>();

  for (const schedule of schedules) {
    const now = new Date();
    try {
      let state = stateCache.get(schedule.chargerId);
      if (!state) {
        const isOnline = onlineByChargerId.get(schedule.chargerId) ?? false;
        state = await getChargerState(schedule.chargerId, isOnline);
        stateCache.set(schedule.chargerId, state);
      }

      const decision = decideNextAction(
        { targetEnergyKwh: Number(schedule.targetEnergyKwh), readyBy: schedule.readyBy },
        state,
        now,
      );

      const decisionDetail = decision.action === "none" ? ` — ${decision.reason}` : "";
      console.log(
        `[scheduler] schedule ${schedule.id} (charger ${schedule.chargerId}): ${decision.action}${decisionDetail}`,
      );

      if (decision.action === "complete") {
        await sendChargerCommand(schedule.chargerId, ZaptecCommand.StopChargingFinal).catch(
          () => undefined,
        );
        await db
          .update(chargeSchedules)
          .set({
            status: "completed",
            lastCommand: "stop",
            lastNote: "Target energy reached",
            lastEvaluatedAt: now,
            lastError: null,
            updatedAt: now,
          })
          .where(eq(chargeSchedules.id, schedule.id));
        continue;
      }

      if (decision.action === "resume" || decision.action === "pause") {
        const commandId =
          decision.action === "resume"
            ? ZaptecCommand.ResumeCharging
            : ZaptecCommand.StopChargingFinal;
        await sendChargerCommand(schedule.chargerId, commandId);
        await db
          .update(chargeSchedules)
          .set({
            status: "active",
            lastCommand: decision.action,
            lastNote: null,
            lastEvaluatedAt: now,
            lastError: null,
            updatedAt: now,
          })
          .where(eq(chargeSchedules.id, schedule.id));
        continue;
      }

      await db
        .update(chargeSchedules)
        .set({
          status: schedule.status === "pending" ? "active" : schedule.status,
          lastNote: decision.reason,
          lastEvaluatedAt: now,
          updatedAt: now,
        })
        .where(eq(chargeSchedules.id, schedule.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`[scheduler] schedule ${schedule.id} (charger ${schedule.chargerId}) failed: ${message}`);
      await db
        .update(chargeSchedules)
        .set({ lastError: message, lastEvaluatedAt: now, updatedAt: now })
        .where(eq(chargeSchedules.id, schedule.id));
    }
  }

  console.log(`[scheduler] tick done: processed ${schedules.length} schedule(s)`);
  return { processed: schedules.length };
}
