import Link from "next/link";
import { inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { chargeSchedules } from "@/lib/db/schema";
import { listChargers, getChargerState } from "@/lib/zaptec/client";
import { estimateChargingPlan } from "@/lib/scheduler/engine";
import { ChargerStatusCard } from "@/components/ChargerStatusCard";
import { ChargingPlanCard } from "@/components/ChargingPlanCard";
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

  // This is a single-charger household app; createSchedule() rejects
  // overlapping schedules per charger, so there's at most one plan to show.
  const charger = chargers[0];
  const schedule = charger ? (schedules.find((s) => s.chargerId === charger.id) ?? null) : null;

  let startTime: string | null = null;
  if (schedule?.status === "pending" && charger) {
    const state = chargerStateById.get(charger.id);
    if (state) {
      const { latestStartTime } = estimateChargingPlan(
        { targetEnergyKwh: Number(schedule.targetEnergyKwh), readyBy: schedule.readyBy },
        state,
      );
      startTime = latestStartTime.toISOString();
    }
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
        {chargers.map((c, index) => (
          <ChargerStatusCard
            key={c.id}
            name={c.name}
            address={c.installationName}
            state={chargerStates[index]}
            hasActivePlan={schedules.some((s) => s.chargerId === c.id)}
          />
        ))}
      </section>

      {charger && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Charging plan</h2>
          <ChargingPlanCard schedule={schedule} startTime={startTime} />
        </section>
      )}

      <Link href="/history" className="text-sm text-black/50 underline underline-offset-2 dark:text-white/50">
        View history
      </Link>
    </main>
  );
}
