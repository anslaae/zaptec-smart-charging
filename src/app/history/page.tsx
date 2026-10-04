import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { chargeSchedules, chargeSessions } from "@/lib/db/schema";

export default async function HistoryPage() {
  await getCurrentUser();

  const [pastSchedules, sessions] = await Promise.all([
    db
      .select()
      .from(chargeSchedules)
      .where(inArray(chargeSchedules.status, ["completed", "cancelled"]))
      .orderBy(desc(chargeSchedules.updatedAt))
      .limit(20),
    db.select().from(chargeSessions).orderBy(desc(chargeSessions.createdAt)).limit(20),
  ]);

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
              {schedule.readyBy.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Charging sessions</h2>
        {sessions.length === 0 && (
          <p className="text-sm text-black/50 dark:text-white/50">
            No sessions logged yet. Configure the session-end webhook in the Zaptec portal to
            populate this list.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {sessions.map((session) => (
            <li key={session.id} className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/15">
              {session.energyKwh ? `${Number(session.energyKwh).toFixed(1)} kWh` : "Unknown energy"}{" "}
              — ended{" "}
              {session.endedAt?.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) ??
                "—"}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
