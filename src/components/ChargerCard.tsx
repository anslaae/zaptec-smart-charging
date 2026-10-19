"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { ChargerState } from "@/lib/zaptec/types";
import type { StateOfCharge } from "@/lib/smartcar/types";
import { describeOperationMode, isCurrentlyCharging, appHasControl } from "@/lib/zaptec/state";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import { ManualChargeButton } from "@/components/ManualChargeButton";
import { PreheatButton } from "@/components/PreheatButton";
import { cancelSchedule, type ActionResult } from "@/lib/schedules/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { SchedulerStatusBadge } from "@/components/SchedulerStatusBadge";
import { useDebugScenario } from "@/components/DebugProvider";
import { DEBUG_SCENARIOS } from "@/lib/debug/scenarios";
import { formatOsloDateTime } from "@/lib/datetime";
import type { chargeSchedules } from "@/lib/db/schema";

type Schedule = typeof chargeSchedules.$inferSelect;

const STATUS_LABEL: Record<Schedule["status"], string> = {
  pending: "Scheduled",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
};

// myOpel's App Store listing -- tapping this opens the app directly if it's
// already installed (standard iOS behavior for an apps.apple.com link) or
// the install page if not. There's no confirmed custom URL scheme for
// myOpel to deep-link straight into climate control, so this is the honest
// option rather than a guessed scheme that could silently do nothing.
const MYOPEL_APP_STORE_URL = "https://apps.apple.com/app/id1439342035";
const MYOPEL_PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.psa.mym.myopel";

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
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
  stateOfCharge,
}: {
  name: string;
  address: string;
  state: ChargerState;
  schedule: Schedule | null;
  startTime: string | null;
  lastTickAt: Date | null;
  stateOfCharge: StateOfCharge | null;
}) {
  // A debug scenario is a pure front-end preview -- it replaces what's
  // rendered without touching real data, and (below) the real action
  // buttons are swapped for a disabled note so a click can't send an actual
  // Zaptec command based on fake displayed state.
  const debug = useDebugScenario();
  const isPreview = debug.enabled && debug.scenario !== "real";
  const effective = isPreview ? DEBUG_SCENARIOS[debug.scenario] : null;
  const effectiveState = effective?.state ?? state;
  const effectiveSchedule = effective ? effective.schedule : schedule;
  const effectiveStartTime = effective ? effective.startTime : startTime;
  // A debug preview swaps in fake charger state; a real battery reading
  // shown alongside it would be misleading, so it's hidden during preview
  // too, same as the real action buttons are.
  const effectiveStateOfCharge = isPreview ? null : stateOfCharge;

  const charging = isCurrentlyCharging(effectiveState);
  const noCarConnected = effectiveState.operationMode === ChargerOperationMode.Disconnected;
  const inControl = appHasControl(effectiveState);

  const [cancelState, cancelAction] = useActionState(
    cancelSchedule.bind(null, schedule?.id ?? ""),
    cancelInitialState,
  );

  // Survives the Preheat button being swapped out for "Stop charging" once
  // charging actually starts (see PreheatButton's onStarted comment) --
  // resets on a real page load/navigation, which is fine for a one-shot
  // nudge like this.
  const [preheatStarted, setPreheatStarted] = useState(false);

  useEffect(() => {
    if (cancelState.error) {
      toast.error("Couldn't cancel the plan", { description: cancelState.error });
    } else if (cancelState.success) {
      toast.success("Charging plan cancelled");
    }
  }, [cancelState]);

  return (
    <div className="rounded-xl border border-black/10 p-4 dark:border-white/15">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold">{name}</h2>
        {effectiveStateOfCharge && (
          <div className="text-right leading-tight">
            <span className="block text-sm font-semibold text-black/70 dark:text-white/70">
              {effectiveStateOfCharge.percent}%
            </span>
            <span className="block text-[11px] text-black/40 dark:text-white/40">
              as of {formatOsloDateTime(effectiveStateOfCharge.oemUpdatedAt)}
            </span>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <SchedulerStatusBadge lastTickAt={lastTickAt} />
        <StatusPill tone={charging ? "green" : "neutral"}>
          {describeOperationMode(effectiveState)}
        </StatusPill>
        {!inControl && <StatusPill tone="amber">App not in control</StatusPill>}
        {isPreview && <StatusPill tone="red">Preview: {DEBUG_SCENARIOS[debug.scenario].label}</StatusPill>}
      </div>

      {inControl && (
        <div className="mt-3 flex flex-col gap-1 text-sm">
          {effectiveSchedule ? (
            <>
              <p className="font-medium">
                {Number(effectiveSchedule.targetEnergyKwh).toFixed(1)} kWh by{" "}
                {formatOsloDateTime(effectiveSchedule.readyBy)}
              </p>
              <p className="text-black/50 dark:text-white/50">
                {STATUS_LABEL[effectiveSchedule.status]}
                {effectiveSchedule.lastNote ? ` · ${effectiveSchedule.lastNote}` : ""}
              </p>
              {effectiveSchedule.status === "pending" && effectiveStartTime && (
                <p className="text-black/50 dark:text-white/50">
                  Starts around {formatOsloDateTime(effectiveStartTime)}
                </p>
              )}
              {effectiveSchedule.lastError && (
                <p className="text-red-600">{effectiveSchedule.lastError}</p>
              )}
              {charging && (
                <p className="text-black/50 dark:text-white/50">{liveChargingSummary(effectiveState)}</p>
              )}
            </>
          ) : charging ? (
            <>
              <p className="font-medium">Charging now</p>
              <p className="text-black/50 dark:text-white/50">{liveChargingSummary(effectiveState)}</p>
            </>
          ) : (
            <p className="font-medium">
              {noCarConnected ? "No car connected" : "No charging planned"}
            </p>
          )}

          {effectiveState.scheduledChargingStartAt && (
            <p className="mt-1 rounded-md bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-700 dark:text-blue-400">
              Zaptec smart charging scheduled to start{" "}
              {formatOsloDateTime(effectiveState.scheduledChargingStartAt)}
            </p>
          )}
        </div>
      )}

      {(address || effectiveState.lastCompletedSession || effectiveState.maxPowerKw != null) && (
        <details className="mt-3 group">
          <summary className="cursor-pointer list-none text-xs font-medium text-black/50 [&::-webkit-details-marker]:hidden dark:text-white/50">
            Details
          </summary>
          <div className="mt-2 flex flex-col gap-1 text-xs text-black/60 dark:text-white/60">
            {address && <p>{address}</p>}
            {effectiveState.lastCompletedSession && (
              <p>
                Last connected {formatOsloDateTime(effectiveState.lastCompletedSession.startedAt)} ·{" "}
                {effectiveState.lastCompletedSession.energyKwh.toFixed(1)} kWh delivered
              </p>
            )}
            {effectiveState.maxPowerKw != null && (
              <p>Max charge rate: {effectiveState.maxPowerKw.toFixed(1)} kW</p>
            )}
          </div>
        </details>
      )}

      <div className="mt-4 border-t border-black/10 pt-3 dark:border-white/15">
        {isPreview ? (
          <p className="text-xs text-black/50 dark:text-white/50">
            Previewing a debug scenario -- real controls are hidden so a click here can&apos;t send
            an actual command.
          </p>
        ) : !inControl ? (
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
            {preheatStarted && (
              <a
                href={
                  typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)
                    ? MYOPEL_PLAY_STORE_URL
                    : MYOPEL_APP_STORE_URL
                }
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 shrink-0 items-center justify-center rounded-md border border-black/10 px-3 text-sm font-medium hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
              >
                Open myOpel →
              </a>
            )}
            {charging ? (
              <ManualChargeButton chargerId={state.chargerId} chargerName={name} mode="stop" />
            ) : noCarConnected ? null : (
              <>
                <PreheatButton
                  chargerId={state.chargerId}
                  chargerName={name}
                  onStarted={() => setPreheatStarted(true)}
                />
                <ManualChargeButton chargerId={state.chargerId} chargerName={name} mode="start" />
              </>
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
