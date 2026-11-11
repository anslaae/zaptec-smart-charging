import { notFound } from "next/navigation";
import { desc, inArray, isNull, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { chargeSchedules, manualChargeSessions, schedulerHeartbeat, webhookEvents } from "@/lib/db/schema";
import { MOCK_MODE } from "@/lib/mock/mode";
import { mockStore } from "@/lib/mock/store";
import { PRESETS } from "@/lib/mock/presets";
import { MockPanel } from "@/components/MockPanel";

// The mock-mode control panel: switch between app states, drive the simulated
// charger/car, and fire the calls that normally come from outside (cron,
// Zaptec and Smartcar webhooks, the uptime monitor). 404 outside mock mode.
export default async function MockPanelPage() {
  if (!MOCK_MODE) notFound();
  await getCurrentUser();

  const now = new Date();
  const store = mockStore();
  const [openPlans, openSessions, heartbeat, webhooks] = await Promise.all([
    db
      .select({
        status: chargeSchedules.status,
        targetEnergyKwh: chargeSchedules.targetEnergyKwh,
        readyBy: chargeSchedules.readyBy,
        lastNote: chargeSchedules.lastNote,
        lastError: chargeSchedules.lastError,
      })
      .from(chargeSchedules)
      .where(inArray(chargeSchedules.status, ["pending", "active"])),
    db.select({ startedAt: manualChargeSessions.startedAt }).from(manualChargeSessions).where(isNull(manualChargeSessions.endedAt)),
    db
      .select({ lastTickAt: schedulerHeartbeat.lastTickAt })
      .from(schedulerHeartbeat)
      .where(eq(schedulerHeartbeat.id, "singleton"))
      .then((rows) => rows[0] ?? null),
    db
      .select({ eventType: webhookEvents.eventType, receivedAt: webhookEvents.receivedAt })
      .from(webhookEvents)
      .orderBy(desc(webhookEvents.receivedAt))
      .limit(5),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 pt-6 pb-4">
      <MockPanel
        presets={Object.entries(PRESETS).map(([key, label]) => ({ key, label }))}
        sim={store.sim.snapshot(now)}
        log={store.log.slice(0, 40)}
        db={{
          openPlans: openPlans.map((p) => ({
            status: p.status,
            targetEnergyKwh: Number(p.targetEnergyKwh),
            readyBy: p.readyBy.toISOString(),
            note: p.lastError ?? p.lastNote,
          })),
          openSessions: openSessions.length,
          lastTickAt: heartbeat?.lastTickAt.toISOString() ?? null,
          webhooks: webhooks.map((w) => ({ eventType: w.eventType, receivedAt: w.receivedAt.toISOString() })),
        }}
      />
    </main>
  );
}
