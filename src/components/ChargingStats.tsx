import type { ChargeHistoryEntry } from "@/lib/zaptec/types";
import { HOUSEHOLD_TIME_ZONE, zonedDateKey } from "@/lib/datetime";

const TREND_DAYS = 14;

export function ChargingStats({ sessions }: { sessions: ChargeHistoryEntry[] }) {
  if (sessions.length === 0) {
    return (
      <p className="text-sm text-black/50 dark:text-white/50">No charging sessions recorded yet.</p>
    );
  }

  const totalEnergyKwh = sessions.reduce((sum, s) => sum + s.energyKwh, 0);
  const avgEnergyKwh = totalEnergyKwh / sessions.length;

  const longestDurationMs = sessions.reduce((max, s) => {
    if (!s.endedAt) return max;
    const durationMs = new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime();
    return Math.max(max, durationMs);
  }, 0);

  // Average power actually achieved per session (energy / duration), to show
  // how consistent real-world charging rate is — and as a sanity check
  // against the circuit-derived theoretical max shown on the dashboard.
  // Sessions under 5 minutes are excluded: a session that barely started
  // skews the rate wildly (near-zero duration, nonzero energy).
  const MIN_SESSION_DURATION_MS = 5 * 60_000;
  const sessionPowersKw = sessions
    .map((s) => {
      if (!s.endedAt) return null;
      const durationHours = (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 3_600_000;
      if (durationHours * 3_600_000 < MIN_SESSION_DURATION_MS) return null;
      return s.energyKwh / durationHours;
    })
    .filter((p): p is number => p != null);

  let avgPowerKw: number | null = null;
  let powerStdDevKw: number | null = null;
  if (sessionPowersKw.length > 0) {
    avgPowerKw = sessionPowersKw.reduce((sum, p) => sum + p, 0) / sessionPowersKw.length;
    const variance =
      sessionPowersKw.reduce((sum, p) => sum + (p - avgPowerKw!) ** 2, 0) / sessionPowersKw.length;
    powerStdDevKw = Math.sqrt(variance);
  }

  const energyByUser = new Map<string, number>();
  for (const s of sessions) {
    const key = s.userFullName ?? "Unknown";
    energyByUser.set(key, (energyByUser.get(key) ?? 0) + s.energyKwh);
  }
  const topUser = [...energyByUser.entries()].sort((a, b) => b[1] - a[1])[0];

  const now = new Date();
  const dailyTotals = Array.from({ length: TREND_DAYS }, (_, i) => {
    const dayKey = zonedDateKey(
      new Date(now.getTime() - (TREND_DAYS - 1 - i) * 86_400_000),
      HOUSEHOLD_TIME_ZONE,
    );
    const energy = sessions
      .filter((s) => zonedDateKey(new Date(s.startedAt), HOUSEHOLD_TIME_ZONE) === dayKey)
      .reduce((sum, s) => sum + s.energyKwh, 0);
    return energy;
  });
  const maxDaily = Math.max(1, ...dailyTotals);

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Stat label="Total charged" value={`${totalEnergyKwh.toFixed(1)} kWh`} />
        <Stat label="Sessions" value={String(sessions.length)} />
        <Stat label="Avg. per session" value={`${avgEnergyKwh.toFixed(1)} kWh`} />
        <Stat
          label="Longest session"
          value={longestDurationMs > 0 ? `${(longestDurationMs / 3_600_000).toFixed(1)} h` : "—"}
        />
        {avgPowerKw != null && (
          <Stat
            label="Effective rate (incl. idle time)"
            value={`${avgPowerKw.toFixed(1)} kW ${describeStability(avgPowerKw, powerStdDevKw)}`}
            wide
          />
        )}
        {topUser && (
          <Stat label="Top charger" value={`${topUser[0]} — ${topUser[1].toFixed(1)} kWh`} wide />
        )}
      </dl>
      {avgPowerKw != null && (
        <p className="text-xs text-black/50 dark:text-white/50">
          Effective rate is energy delivered ÷ total time plugged in, not the charger&apos;s actual
          charging speed — sessions often sit idle (car finished, or still plugged in) for part of
          that time, so this will read well below the charger&apos;s real max output.
        </p>
      )}

      <div>
        <p className="mb-2 text-xs text-black/50 dark:text-white/50">
          Last {TREND_DAYS} days (kWh/day)
        </p>
        <svg
          viewBox={`0 0 ${TREND_DAYS * 16} 60`}
          className="h-16 w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Energy charged per day over the last ${TREND_DAYS} days`}
        >
          {dailyTotals.map((energy, i) => {
            const height = (energy / maxDaily) * 56;
            return (
              <rect
                key={i}
                x={i * 16 + 3}
                y={60 - height}
                width={10}
                height={Math.max(height, energy > 0 ? 2 : 0)}
                rx={2}
                className="fill-green-500/70"
              >
                <title>{energy.toFixed(1)} kWh</title>
              </rect>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// Coefficient of variation (stddev / mean) as a plain-language read on
// whether the achieved charge rate is consistent session-to-session, or
// swings around a lot (e.g. shared circuit load, weather affecting AC
// charging efficiency, partial sessions).
function describeStability(avgKw: number, stdDevKw: number | null): string {
  if (stdDevKw == null) return "";
  const coefficientOfVariation = avgKw > 0 ? stdDevKw / avgKw : 0;
  const label =
    coefficientOfVariation < 0.15
      ? "stable"
      : coefficientOfVariation < 0.35
        ? "somewhat variable"
        : "highly variable";
  return `(±${stdDevKw.toFixed(1)} kW, ${label})`;
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div
      className={`rounded-xl border border-black/10 p-3 dark:border-white/15 ${wide ? "col-span-2" : ""}`}
    >
      <dt className="text-black/50 dark:text-white/50">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
