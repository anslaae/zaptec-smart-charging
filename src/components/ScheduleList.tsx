import { cancelSchedule } from "@/lib/schedules/actions";
import { HOUSEHOLD_TIME_ZONE } from "@/lib/datetime";
import type { chargeSchedules } from "@/lib/db/schema";

type Schedule = typeof chargeSchedules.$inferSelect;

const STATUS_LABEL: Record<Schedule["status"], string> = {
  pending: "Scheduled",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function ScheduleList({ schedules }: { schedules: Schedule[] }) {
  if (schedules.length === 0) {
    return <p className="text-sm text-black/50 dark:text-white/50">No active schedules.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {schedules.map((schedule) => (
        <li
          key={schedule.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-black/10 p-4 dark:border-white/15"
        >
          <div>
            <p className="font-medium">
              {Number(schedule.targetEnergyKwh).toFixed(1)} kWh on {schedule.chargerName}
              {schedule.simulate && (
                <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                  Simulated
                </span>
              )}
            </p>
            <p className="text-sm text-black/50 dark:text-white/50">
              Ready by{" "}
              {schedule.readyBy.toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: HOUSEHOLD_TIME_ZONE,
                hour12: false,
              })}{" "}
              · {STATUS_LABEL[schedule.status]}
              {schedule.lastNote ? ` · ${schedule.lastNote}` : ""}
            </p>
            {schedule.lastError && (
              <p className="text-sm text-red-600">Last error: {schedule.lastError}</p>
            )}
          </div>
          <form action={cancelSchedule.bind(null, schedule.id)}>
            <button
              type="submit"
              className="shrink-0 rounded-md border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
            >
              Cancel
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
