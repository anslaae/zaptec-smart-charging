"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { cancelSchedule, type ActionResult } from "@/lib/schedules/actions";
import { HOUSEHOLD_TIME_ZONE } from "@/lib/datetime";
import { SubmitButton } from "@/components/SubmitButton";
import type { chargeSchedules } from "@/lib/db/schema";

type Schedule = typeof chargeSchedules.$inferSelect;

const STATUS_LABEL: Record<Schedule["status"], string> = {
  pending: "Scheduled",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};

const initialState: ActionResult = {};

// A single-charger household only ever has at most one pending/active
// schedule at a time (createSchedule rejects overlaps), so this shows that
// one plan directly rather than a list.
export function ChargingPlanCard({
  schedule,
  startTime,
}: {
  schedule: Schedule | null;
  startTime: string | null;
}) {
  const [cancelState, cancelAction] = useActionState(
    cancelSchedule.bind(null, schedule?.id ?? ""),
    initialState,
  );

  useEffect(() => {
    if (cancelState.error) {
      toast.error("Couldn't cancel the plan", { description: cancelState.error });
    } else if (cancelState.success) {
      toast.success("Charging plan cancelled");
    }
  }, [cancelState]);

  if (!schedule) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-black/10 p-4 dark:border-white/15">
        <p className="text-sm text-black/50 dark:text-white/50">No charging planned.</p>
        <Link
          href="/schedule/quick"
          className="shrink-0 rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background"
        >
          Plan charging
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-black/10 p-4 dark:border-white/15">
      <div>
        <p className="font-medium">{Number(schedule.targetEnergyKwh).toFixed(1)} kWh</p>
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
        {schedule.status === "pending" && startTime && (
          <p className="text-sm text-black/50 dark:text-white/50">
            Starts charging around{" "}
            {new Date(startTime).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: HOUSEHOLD_TIME_ZONE,
              hour12: false,
            })}
          </p>
        )}
        {schedule.lastError && (
          <p className="text-sm text-red-600">Last error: {schedule.lastError}</p>
        )}
      </div>
      <form action={cancelAction}>
        <SubmitButton
          pendingLabel="Cancelling…"
          className="shrink-0 rounded-md border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
        >
          Cancel
        </SubmitButton>
      </form>
    </div>
  );
}
