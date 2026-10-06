import type { ChargerState } from "@/lib/zaptec/types";
import { describeOperationMode, isCurrentlyCharging } from "@/lib/zaptec/state";
import { startChargingNow, stopChargingNow } from "@/lib/zaptec/actions";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import { SubmitButton } from "@/components/SubmitButton";
import { HOUSEHOLD_TIME_ZONE } from "@/lib/datetime";

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatOsloDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: HOUSEHOLD_TIME_ZONE,
    hour12: false,
  });
}

export function ChargerStatusCard({
  name,
  address,
  state,
  hasActivePlan,
}: {
  name: string;
  address: string;
  state: ChargerState;
  hasActivePlan: boolean;
}) {
  const charging = isCurrentlyCharging(state);
  const noCarConnected = state.operationMode === ChargerOperationMode.Disconnected;

  return (
    <div className="rounded-xl border border-black/10 p-4 dark:border-white/15">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">{name}</h2>
          <p className="text-xs text-black/50 dark:text-white/50">{address}</p>
        </div>
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

      {hasActivePlan ? (
        <p className="mt-3 text-xs text-black/50 dark:text-white/50">
          Manual controls are off while charging is planned — cancel the plan to use them.
        </p>
      ) : charging ? (
        <form action={stopChargingNow.bind(null, state.chargerId)} className="mt-3">
          <SubmitButton
            pendingLabel="Stopping…"
            className="w-full rounded-md border border-black/10 px-3 py-2 text-sm font-medium dark:border-white/15"
          >
            Stop charging
          </SubmitButton>
        </form>
      ) : noCarConnected ? (
        <p className="mt-3 text-xs text-black/50 dark:text-white/50">
          Plug in the car to start charging manually.
        </p>
      ) : (
        <form action={startChargingNow.bind(null, state.chargerId)} className="mt-3">
          <SubmitButton
            pendingLabel="Starting…"
            className="w-full rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background"
          >
            Start charging
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
