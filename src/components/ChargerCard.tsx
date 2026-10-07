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
import { SchedulerStatusBadge } from "@/components/SchedulerStatusBadge";
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

function liveChargingSummary(state: ChargerState): string {
  return [
    state.instantPowerWatts != null ? `${(state.instantPowerWatts / 1000).toFixed(1)} kW` : null,
    state.sessionEnergyKwh != null ? `${state.sessionEnergyKwh.toFixed(1)} kWh delivered` : null,
    state.chargeDurationSeconds != null ? formatDuration(state.chargeDurationSeconds) : null,
  ]
    .filter((part): part is string => part != null)
    .join(" · ");
}

function StatusPill({
  tone,
  children,
}: {
  tone: "green" | "neutral" | "amber" | "red";
  children: React.ReactNode;
}) {
  const toneClasses = {
    green: "bg-green-500/15 text-green-700 dark:text-green-400",
    neutral: "bg-black/5 text-black/60 dark:bg-white/10 dark:text-white/60",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    red: "bg-red-500/15 text-red-700 dark:text-red-400",
  }[tone];
  const dotClasses = {
    green: "bg-green-500",
    neutral: "bg-current",
    amber: "bg-amber-500",
    red: "bg-red-500",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClasses}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClasses}`} />
      {children}
    </span>
  );
}

const cancelInitialState: ActionResult = {};

// One box per charger, read top to bottom as: every status indicator
// together (scheduler tick, charger state, control), then whatever's
// actually relevant right now (a plan, live charging numbers, or just "plug
// in"), secondary detail tucked into a collapsible section, and finally the
// action a household member would actually take.
export function ChargerCard({
  name,
  address,
  state,
  schedule,
  startTime,
  lastTickAt,
}: {
  name: string;
  address: string;
  state: ChargerState;
  schedule: Schedule | null;
  startTime: string | null;
  lastTickAt: Date | null;
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
      <h2 className="text-base font-semibold">{name}</h2>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <SchedulerStatusBadge lastTickAt={lastTickAt} />
        <StatusPill tone={charging ? "green" : "neutral"}>{describeOperationMode(state)}</StatusPill>
        {!inControl && <StatusPill tone="amber">App not in control</StatusPill>}
      </div>

      {inControl && (
        <div className="mt-3 flex flex-col gap-1 text-sm">
          {schedule ? (
            <>
              <p className="font-medium">
                {Number(schedule.targetEnergyKwh).toFixed(1)} kWh by {formatOsloDateTime(schedule.readyBy)}
              </p>
              <p className="text-black/50 dark:text-white/50">
                {STATUS_LABEL[schedule.status]}
                {schedule.lastNote ? ` · ${schedule.lastNote}` : ""}
              </p>
              {schedule.status === "pending" && startTime && (
                <p className="text-black/50 dark:text-white/50">
                  Starts around {formatOsloDateTime(startTime)}
                </p>
              )}
              {schedule.lastError && <p className="text-red-600">{schedule.lastError}</p>}
              {charging && (
                <p className="text-black/50 dark:text-white/50">{liveChargingSummary(state)}</p>
              )}
            </>
          ) : charging ? (
            <>
              <p className="font-medium">Charging now</p>
              <p className="text-black/50 dark:text-white/50">{liveChargingSummary(state)}</p>
            </>
          ) : (
            <p className="font-medium">
              {noCarConnected ? "No car connected" : "No charging planned"}
            </p>
          )}

          {state.scheduledChargingStartAt && (
            <p className="mt-1 rounded-md bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-700 dark:text-blue-400">
              Zaptec smart charging scheduled to start {formatOsloDateTime(state.scheduledChargingStartAt)}
            </p>
          )}
        </div>
      )}

      {(address || state.lastCompletedSession || state.maxPowerKw != null) && (
        <details className="mt-3 group">
          <summary className="cursor-pointer list-none text-xs font-medium text-black/50 [&::-webkit-details-marker]:hidden dark:text-white/50">
            Details
          </summary>
          <div className="mt-2 flex flex-col gap-1 text-xs text-black/60 dark:text-white/60">
            {address && <p>{address}</p>}
            {state.lastCompletedSession && (
              <p>
                Last connected {formatOsloDateTime(state.lastCompletedSession.startedAt)} ·{" "}
                {state.lastCompletedSession.energyKwh.toFixed(1)} kWh delivered
              </p>
            )}
            {state.maxPowerKw != null && <p>Max charge rate: {state.maxPowerKw.toFixed(1)} kW</p>}
          </div>
        </details>
      )}

      <div className="mt-4 border-t border-black/10 pt-3 dark:border-white/15">
        {!inControl ? (
          <p className="text-xs text-black/50 dark:text-white/50">
            Require authentication is on and there&apos;s no session to manage right now -- start
            charging from the Zaptec app, or switch the installation back to free charging to
            restore automation here.
          </p>
        ) : schedule ? (
          <div className="flex justify-end">
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
          <div className="flex items-center justify-end gap-2">
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
