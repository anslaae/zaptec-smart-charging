import Link from "next/link";
import { Suspense } from "react";
import { eq, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { chargeSchedules, schedulerHeartbeat } from "@/lib/db/schema";
import { listChargers, getChargerState } from "@/lib/zaptec/client";
import { estimateChargingPlan } from "@/lib/scheduler/engine";
import { ChargerCard } from "@/components/ChargerCard";
import { ScheduleCreatedToast } from "@/components/ScheduleCreatedToast";
import { LogoutButton } from "@/components/LogoutButton";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DebugProvider } from "@/components/DebugProvider";
import { NotificationToggle } from "@/components/NotificationToggle";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  const [chargers, schedules, heartbeat] = await Promise.all([
    listChargers(),
    db
      .select()
      .from(chargeSchedules)
      .where(inArray(chargeSchedules.status, ["pending", "active"]))
      .orderBy(chargeSchedules.readyBy),
    db
      .select({ lastTickAt: schedulerHeartbeat.lastTickAt })
      .from(schedulerHeartbeat)
      .where(eq(schedulerHeartbeat.id, "singleton"))
      .then((rows) => rows[0] ?? null),
  ]);

  const chargerStates = await Promise.all(
    chargers.map((charger) =>
      getChargerState(charger.id, charger.isOnline, charger.circuitId, charger.installationId),
    ),
  );

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-8">
      <AutoRefresh />
      <Suspense fallback={null}>
        <ScheduleCreatedToast />
      </Suspense>
      <DebugProvider buildSha={process.env.BUILD_SHA ?? "unknown"} buildEnv={process.env.BUILD_ENV ?? "unknown"}>
        <header className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold">Smart Charging</h1>
            <p className="text-sm text-black/50 dark:text-white/50">Hi {user.name}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <LogoutButton />
            <NotificationToggle />
          </div>
        </header>

        <section className="flex flex-col gap-3">
          {chargers.length === 0 && (
            <p className="text-sm text-black/50 dark:text-white/50">
              No chargers found on the connected Zaptec account.
            </p>
          )}
          {chargers.map((c, index) => {
            const state = chargerStates[index];
            // createSchedule() rejects overlapping schedules per charger, so
            // there's at most one pending/active plan per charger.
            const schedule = schedules.find((s) => s.chargerId === c.id) ?? null;
            const startTime =
              schedule?.status === "pending"
                ? estimateChargingPlan(
                    { targetEnergyKwh: Number(schedule.targetEnergyKwh), readyBy: schedule.readyBy },
                    state,
                  ).latestStartTime.toISOString()
                : null;
            return (
              <ChargerCard
                key={c.id}
                name={c.name}
                address={c.installationName}
                state={state}
                schedule={schedule}
                startTime={startTime}
                lastTickAt={heartbeat?.lastTickAt ?? null}
              />
            );
          })}
        </section>

        <Link href="/history" className="text-sm text-black/50 underline underline-offset-2 dark:text-white/50">
          View history
        </Link>
      </DebugProvider>
    </main>
  );
}
