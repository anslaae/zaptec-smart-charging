import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { chargeSchedules } from "@/lib/db/schema";
import { listChargers, getChargeHistory } from "@/lib/zaptec/client";
import { ChargingStats } from "@/components/ChargingStats";
import { HOUSEHOLD_TIME_ZONE } from "@/lib/datetime";

export default async function HistoryPage() {
  await getCurrentUser();

  const [pastSchedules, chargers] = await Promise.all([
    db
      .select()
      .from(chargeSchedules)
      .where(inArray(chargeSchedules.status, ["completed", "cancelled"]))
      .orderBy(desc(chargeSchedules.updatedAt))
      .limit(20),
    listChargers(),
  ]);

  const sessionsByCharger = await Promise.all(
    chargers.map((charger) => getChargeHistory(charger.id)),
  );
  const sessions = sessionsByCharger
    .flat()
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-8">
      <div>
        <Link href="/" className="text-sm text-black/50 underline underline-offset-2 dark:text-white/50">
          ← Back
        </Link>
        <h1 className="mt-2 text-xl font-semibold">History</h1>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Past schedules</h2>
        {pastSchedules.length === 0 && (
          <p className="text-sm text-black/50 dark:text-white/50">No past schedules yet.</p>
        )}
        <ul className="flex flex-col gap-2">
          {pastSchedules.map((schedule) => (
            <li key={schedule.id} className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/15">
              {Number(schedule.targetEnergyKwh).toFixed(1)} kWh on {schedule.chargerName} —{" "}
              {schedule.status} — ready by{" "}
              {schedule.readyBy.toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: HOUSEHOLD_TIME_ZONE,
                hour12: false,
              })}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Charging activity</h2>
        <ChargingStats sessions={sessions} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">All sessions</h2>
        {sessions.length === 0 && (
          <p className="text-sm text-black/50 dark:text-white/50">No sessions recorded yet.</p>
        )}
        <ul className="flex flex-col gap-2">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/15"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{session.energyKwh.toFixed(1)} kWh</span>
                <span className="text-black/50 dark:text-white/50">
                  {new Date(session.startedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: HOUSEHOLD_TIME_ZONE,
                    hour12: false,
                  })}
                </span>
              </div>
              {session.userFullName && (
                <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                  {session.userFullName}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
