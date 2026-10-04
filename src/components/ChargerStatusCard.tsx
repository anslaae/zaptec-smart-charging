import type { ChargerState } from "@/lib/zaptec/types";
import { describeOperationMode, isCurrentlyCharging } from "@/lib/zaptec/state";

export function ChargerStatusCard({
  name,
  state,
}: {
  name: string;
  state: ChargerState;
}) {
  const charging = isCurrentlyCharging(state);

  return (
    <div className="rounded-xl border border-black/10 p-4 dark:border-white/15">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{name}</h2>
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
      </dl>
    </div>
  );
}
