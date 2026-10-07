"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { ChargerState } from "@/lib/zaptec/types";
import { describeOperationMode, isCurrentlyCharging, appHasControl } from "@/lib/zaptec/state";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import { ManualChargeButton } from "@/components/ManualChargeButton";
import { cancelSchedule, type ActionResult } from "@/lib/schedules/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { HOUSEHOLD_TIME_ZONE } from "@/lib/datetime";
import type { chargeSchedules } from "@/lib/db/schema";

type Schedule = typeof chargeSchedules.$inferSelect;

const STATUS_LABEL: Record<Schedule["status"], string> = {
  pending: "Scheduled",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatOsloDateTime(date: string | Date): string {
  return new Date(date).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: HOUSEHOLD_TIME_ZONE,
    hour12: false,
  });
}

const cancelInitialState: ActionResult = {};

// One box per charger: live status, the current plan (if any) with a cancel
// button, and -- only when there's no plan -- manual start/stop beside a
// shortcut to create one. Everything a household member needs to glance at
// or act on for this charger lives here, instead of split across two cards.
export function ChargerCard({
  name,
  address,
  state,
  schedule,
  startTime,
}: {
  name: string;
  address: string;
  state: ChargerState;
  schedule: Schedule | null;
  startTime: string | null;
}) {
  const charging = isCurrentlyCharging(state);
  const noCarConnected = state.operationMode === ChargerOperationMode.Disconnected;
  const inControl = appHasControl(state);

  const [cancelState, cancelAction] = useActionState(
    cancelSchedule.bind(null, schedule?.id ?? ""),
    cancelInitialState,
  );

  useEffect(() => {
    if (cancelState.error) {
      toast.error("Couldn't cancel the plan", { description: cancelState.error });
    } else if (cancelState.success) {
      toast.success("Charging plan cancelled");
    }
  }, [cancelState]);

  return (
    <div className="rounded-xl border border-black/10 p-4 dark:border-white/15">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{name}</h2>
          <p className="text-xs text-black/50 dark:text-white/50">{address}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              charging
                ? "bg-green-500/15 text-green-700 dark:text-green-400"
                : "bg-black/5 text-black/60 dark:bg-white/10 dark:text-white/60"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${charging ? "bg-green-500" : "bg-current"}`}
            />
            {describeOperationMode(state)}
          </span>
          {!inControl && (
            <span
              title="Require authentication is on and there's no session to manage -- authorize charging from the Zaptec app, or switch the installation back to free charging."
              className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              App not in control
            </span>
          )}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-black/50 dark:text-white/50">Power</dt>
          <dd className="font-medium">
            {state.instantPowerWatts != null
              ? `${(state.instantPowerWatts / 1000).toFixed(1)} kW`
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-black/50 dark:text-white/50">Session energy</dt>
          <dd className="font-medium">
            {state.sessionEnergyKwh != null ? `${state.sessionEnergyKwh.toFixed(1)} kWh` : "—"}
          </dd>
        </div>
        {charging && state.chargeDurationSeconds != null && (
          <div>
            <dt className="text-black/50 dark:text-white/50">Charging for</dt>
            <dd className="font-medium">{formatDuration(state.chargeDurationSeconds)}</dd>
          </div>
        )}
      </dl>

      {state.scheduledChargingStartAt && (
        <p className="mt-3 rounded-md bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-700 dark:text-blue-400">
          Smart charging scheduled to start {formatOsloDateTime(state.scheduledChargingStartAt)}
        </p>
      )}

      {state.lastCompletedSession && (
        <p className="mt-3 text-xs text-black/50 dark:text-white/50">
          Last connected {formatOsloDateTime(state.lastCompletedSession.startedAt)} ·{" "}
          {state.lastCompletedSession.energyKwh.toFixed(1)} kWh delivered
        </p>
      )}

      <div className="mt-4 border-t border-black/10 pt-3 dark:border-white/15">
        {!inControl ? (
          <p className="text-xs text-black/50 dark:text-white/50">
            Require authentication is on and there&apos;s no session to manage right now -- start
            charging from the Zaptec app, or switch the installation back to free charging to
            restore automation here.
          </p>
        ) : schedule ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium">{Number(schedule.targetEnergyKwh).toFixed(1)} kWh</p>
              <p className="text-sm text-black/50 dark:text-white/50">
                Ready by {formatOsloDateTime(schedule.readyBy)} · {STATUS_LABEL[schedule.status]}
                {schedule.lastNote ? ` · ${schedule.lastNote}` : ""}
              </p>
              {schedule.status === "pending" && startTime && (
                <p className="text-sm text-black/50 dark:text-white/50">
                  Starts charging around {formatOsloDateTime(startTime)}
                </p>
              )}
              {schedule.lastError && (
                <p className="text-sm text-red-600">Last error: {schedule.lastError}</p>
              )}
            </div>
            <form action={cancelAction}>
              <SubmitButton
                pendingLabel="Cancelling…"
                className="flex h-9 shrink-0 items-center justify-center rounded-md border border-black/10 px-3 text-sm font-medium hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
              >
                Cancel
              </SubmitButton>
            </form>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="flex-1 text-sm text-black/50 dark:text-white/50">
              {noCarConnected ? "Plug in to charge, or plan ahead." : "No charging planned."}
            </p>
            {charging ? (
              <ManualChargeButton chargerId={state.chargerId} chargerName={name} mode="stop" />
            ) : noCarConnected ? null : (
              <ManualChargeButton chargerId={state.chargerId} chargerName={name} mode="start" />
            )}
            <Link
              href="/schedule/quick"
              className="flex h-9 shrink-0 items-center justify-center rounded-md border border-transparent bg-foreground px-3 text-sm font-medium text-background"
            >
              Plan charging
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
