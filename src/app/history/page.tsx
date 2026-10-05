import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { chargeSchedules, scheduleActions } from "@/lib/db/schema";
import { listChargers, getChargeHistory } from "@/lib/zaptec/client";
import { ChargingStats } from "@/components/ChargingStats";
import { HOUSEHOLD_TIME_ZONE } from "@/lib/datetime";

const ACTION_LABEL: Record<string, string> = {
  resume: "Resume charging",
  pause: "Pause charging",
  complete: "Stop charging (target reached)",
};

const SCHEDULE_STATUS_LABEL: Record<string, string> = {
  completed: "Completed",
  cancelled: "Cancelled",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: HOUSEHOLD_TIME_ZONE,
    hour12: false,
  });
}

function formatDuration(durationMs: number): string {
  const totalMinutes = Math.round(durationMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatRange(startedAt: string, endedAt: string | null | undefined): string {
  if (!endedAt) return `${formatTime(startedAt)} → still in progress`;
  const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return `${formatTime(startedAt)} → ${formatTime(endedAt)} (${formatDuration(durationMs)})`;
}

export default async function HistoryPage() {
  await getCurrentUser();

  const [pastSchedules, chargers, recentActions] = await Promise.all([
    db
      .select()
      .from(chargeSchedules)
      .where(inArray(chargeSchedules.status, ["completed", "cancelled"]))
      .orderBy(desc(chargeSchedules.updatedAt))
      .limit(20),
    listChargers(),
    db
      .select({
        id: scheduleActions.id,
        action: scheduleActions.action,
        simulated: scheduleActions.simulated,
        createdAt: scheduleActions.createdAt,
        chargerName: chargeSchedules.chargerName,
      })
      .from(scheduleActions)
      .innerJoin(chargeSchedules, eq(scheduleActions.scheduleId, chargeSchedules.id))
      .orderBy(desc(scheduleActions.createdAt))
      .limit(30),
  ]);

  const sessionsByCharger = await Promise.all(
    chargers.map((charger) => getChargeHistory(charger.id)),
  );
  const sessions = sessionsByCharger
    .flat()
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

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
          {pastSchedules.map((schedule) => {
            // The schedule's own startedAt/endedAt mark when *the schedule*
            // was actively charging. The linked real session's own
            // StartDateTime/EndDateTime span the whole plug-in period
            // (idle time included), so only its delivered energy is used
            // here -- not its timestamps.
            const realSession = schedule.zaptecSessionId
              ? sessionById.get(schedule.zaptecSessionId)
              : undefined;
            const startedAt = schedule.startedAt?.toISOString();
            const endedAt = schedule.endedAt?.toISOString();
            const durationMs =
              startedAt && endedAt
                ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
                : null;

            return (
              <li
                key={schedule.id}
                className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/15"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {Number(schedule.targetEnergyKwh).toFixed(1)} kWh on {schedule.chargerName}
                  </span>
                  {schedule.simulate && (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                      Simulated
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-black/50 dark:text-white/50">
                  {SCHEDULE_STATUS_LABEL[schedule.status] ?? schedule.status} · ready by{" "}
                  {formatTime(schedule.readyBy.toISOString())}
                  {realSession && ` · ${realSession.energyKwh.toFixed(1)} kWh delivered`}
                </p>
                {startedAt && (
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <MiniStat label="Started" value={formatTime(startedAt)} />
                    <MiniStat label="Stopped" value={endedAt ? formatTime(endedAt) : "—"} />
                    <MiniStat
                      label="Duration"
                      value={durationMs != null ? formatDuration(durationMs) : "—"}
                    />
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Recent scheduler actions</h2>
        {recentActions.length === 0 && (
          <p className="text-sm text-black/50 dark:text-white/50">
            No scheduler actions yet — these appear once a schedule tells the charger to
            start/stop.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {recentActions.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-black/10 p-4 text-sm dark:border-white/15"
            >
              <span>
                {ACTION_LABEL[entry.action] ?? entry.action} on {entry.chargerName}
              </span>
              <span className="flex items-center gap-2 text-black/50 dark:text-white/50">
                {entry.simulated && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                    Simulated
                  </span>
                )}
                {entry.createdAt.toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: HOUSEHOLD_TIME_ZONE,
                  hour12: false,
                })}
              </span>
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
              <span className="font-medium">{session.energyKwh.toFixed(1)} kWh</span>
              <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                {formatRange(session.startedAt, session.endedAt)}
              </p>
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-black/50 dark:text-white/50">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
