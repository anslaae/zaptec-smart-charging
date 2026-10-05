import Link from "next/link";
import { inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { chargeSchedules } from "@/lib/db/schema";
import { listChargers, getChargerState } from "@/lib/zaptec/client";
import { estimateChargingPlan } from "@/lib/scheduler/engine";
import { ChargerStatusCard } from "@/components/ChargerStatusCard";
import { ScheduleList } from "@/components/ScheduleList";
import { LogoutButton } from "@/components/LogoutButton";
import { AutoRefresh } from "@/components/AutoRefresh";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  const [chargers, schedules] = await Promise.all([
    listChargers(),
    db
      .select()
      .from(chargeSchedules)
      .where(inArray(chargeSchedules.status, ["pending", "active"]))
      .orderBy(chargeSchedules.readyBy),
  ]);

  const chargerStates = await Promise.all(
    chargers.map((charger) => getChargerState(charger.id, charger.isOnline, charger.circuitId)),
  );
  const chargerStateById = new Map(chargers.map((charger, index) => [charger.id, chargerStates[index]]));

  const startTimes: Record<string, string> = {};
  for (const schedule of schedules) {
    if (schedule.status !== "pending") continue;
    const state = chargerStateById.get(schedule.chargerId);
    if (!state) continue;
    const { latestStartTime } = estimateChargingPlan(
      { targetEnergyKwh: Number(schedule.targetEnergyKwh), readyBy: schedule.readyBy },
      state,
    );
    startTimes[schedule.id] = latestStartTime.toISOString();
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-8">
      <AutoRefresh />
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Smart Charging</h1>
          <p className="text-sm text-black/50 dark:text-white/50">Hi {user.name}</p>
        </div>
        <LogoutButton />
      </header>

      <section className="flex flex-col gap-3">
        {chargers.length === 0 && (
          <p className="text-sm text-black/50 dark:text-white/50">
            No chargers found on the connected Zaptec account.
          </p>
        )}
        {chargers.map((charger, index) => (
          <ChargerStatusCard
            key={charger.id}
            name={charger.name}
            address={charger.installationName}
            state={chargerStates[index]}
          />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Schedules</h2>
          <div className="flex items-center gap-3 text-sm font-medium">
            <Link href="/schedule/quick" className="underline underline-offset-2">
              Quick schedule
            </Link>
          </div>
        </div>
        <ScheduleList schedules={schedules} startTimes={startTimes} />
      </section>

      <Link href="/history" className="text-sm text-black/50 underline underline-offset-2 dark:text-white/50">
        View history
      </Link>
    </main>
  );
}
