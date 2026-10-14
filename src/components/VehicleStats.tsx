import type { vehicleTelemetry } from "@/lib/db/schema";
import { HOUSEHOLD_TIME_ZONE, zonedDateKey, formatOsloDateTime } from "@/lib/datetime";

type TelemetryRow = typeof vehicleTelemetry.$inferSelect;

// Matches ChargingStats' own trend window. Telemetry rows arrive whenever
// the Smartcar webhook reports a genuinely new OEM reading (see
// HANDOVER.md), not on a fixed cadence, so this is a time window, not a
// fixed sample count.
const TREND_DAYS = 30;

const CHART_WIDTH = 300;
const CHART_HEIGHT = 80;
const BASELINE_Y = CHART_HEIGHT - 10;
const PLOT_HEIGHT = BASELINE_Y - 10;

export function VehicleStats({ readings }: { readings: TelemetryRow[] }) {
  if (readings.length === 0) {
    return (
      <p className="text-sm text-black/50 dark:text-white/50">
        No vehicle telemetry recorded yet -- this fills in once the Smartcar webhook delivers its
        first battery/odometer update.
      </p>
    );
  }

  const now = new Date();
  const windowStart = now.getTime() - TREND_DAYS * 86_400_000;
  const batteryPoints = readings
    .filter((r) => r.batteryPercent != null && r.batteryReportedAt && r.batteryReportedAt.getTime() >= windowStart)
    .map((r) => ({ time: r.batteryReportedAt!.getTime(), percent: r.batteryPercent! }));

  const dailyKm = dailyDistanceKm(readings, now);
  const maxDailyKm = Math.max(1, ...dailyKm.map((d) => d.km));

  const latestBattery = readings.findLast((r) => r.batteryPercent != null);

  return (
    <div className="flex flex-col gap-5">
      {batteryPoints.length > 0 && (
        <div>
          <p className="mb-2 text-xs text-black/50 dark:text-white/50">
            Battery over the last {TREND_DAYS} days
          </p>
          <BatteryTrendChart points={batteryPoints} windowStart={windowStart} now={now.getTime()} />
          {latestBattery?.batteryReportedAt && (
            <p className="mt-1 text-xs text-black/40 dark:text-white/40">
              Last reported {formatOsloDateTime(latestBattery.batteryReportedAt)}
            </p>
          )}
        </div>
      )}

      {dailyKm.some((d) => d.km > 0) && (
        <div>
          <p className="mb-2 text-xs text-black/50 dark:text-white/50">
            Distance driven per day, last {TREND_DAYS} days (km)
          </p>
          <svg
            viewBox={`0 0 ${dailyKm.length * 16} 60`}
            className="h-16 w-full"
            preserveAspectRatio="none"
            role="img"
            aria-label={`Kilometers driven per day over the last ${TREND_DAYS} days`}
          >
            {dailyKm.map(({ km }, i) => {
              const height = (km / maxDailyKm) * 56;
              return (
                <rect
                  key={i}
                  x={i * 16 + 3}
                  y={60 - height}
                  width={10}
                  height={Math.max(height, km > 0 ? 2 : 0)}
                  rx={2}
                  className="fill-blue-500/70"
                >
                  <title>{km.toFixed(0)} km</title>
                </rect>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}

// One point per day: the last odometer reading of that day minus the last
// reading on/before the previous day, clamped to >= 0 (a brand-new day with
// no reading yet simply carries no distance rather than going negative).
function dailyDistanceKm(readings: TelemetryRow[], now: Date): { dayKey: string; km: number }[] {
  const withOdometer = readings.filter((r) => r.odometerKm != null && r.odometerReportedAt);
  const lastKmByDay = new Map<string, number>();
  for (const r of withOdometer) {
    const dayKey = zonedDateKey(r.odometerReportedAt!, HOUSEHOLD_TIME_ZONE);
    lastKmByDay.set(dayKey, Number(r.odometerKm));
  }

  const days = Array.from({ length: TREND_DAYS }, (_, i) =>
    zonedDateKey(new Date(now.getTime() - (TREND_DAYS - 1 - i) * 86_400_000), HOUSEHOLD_TIME_ZONE),
  );

  let previousKm: number | null = null;
  return days.map((dayKey) => {
    const kmAtEndOfDay = lastKmByDay.get(dayKey) ?? previousKm;
    const km = previousKm != null && kmAtEndOfDay != null ? Math.max(0, kmAtEndOfDay - previousKm) : 0;
    if (kmAtEndOfDay != null) previousKm = kmAtEndOfDay;
    return { dayKey, km };
  });
}

// A thin 2px rounded line plus a ~10% opacity area wash underneath (per this
// app's chart style -- see ChargingStats' bar chart), x positioned by actual
// elapsed time (not sample index) so gaps between sparse OEM reports show up
// honestly as flat stretches rather than implying even sampling.
function BatteryTrendChart({
  points,
  windowStart,
  now,
}: {
  points: { time: number; percent: number }[];
  windowStart: number;
  now: number;
}) {
  const span = Math.max(1, now - windowStart);
  const toX = (time: number) => ((time - windowStart) / span) * CHART_WIDTH;
  const toY = (percent: number) => BASELINE_Y - (percent / 100) * PLOT_HEIGHT;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.time)},${toY(p.percent)}`).join(" ");
  const areaPath = `${linePath} L ${toX(points[points.length - 1].time)},${BASELINE_Y} L ${toX(points[0].time)},${BASELINE_Y} Z`;
  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="h-20 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Battery percent over the last ${Math.round(span / 86_400_000)} days, currently ${last.percent}%`}
    >
      <line
        x1={0}
        y1={BASELINE_Y}
        x2={CHART_WIDTH}
        y2={BASELINE_Y}
        className="stroke-black/10 dark:stroke-white/15"
        strokeWidth={1}
      />
      <path d={areaPath} className="fill-green-500/10" stroke="none" />
      <path
        d={linePath}
        className="stroke-green-500"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {points.map((p, i) => (
        <circle key={i} cx={toX(p.time)} cy={toY(p.percent)} r={1.5} className="fill-green-500">
          <title>
            {p.percent}% -- {formatOsloDateTime(new Date(p.time))}
          </title>
        </circle>
      ))}
      <circle
        cx={toX(last.time)}
        cy={toY(last.percent)}
        r={4}
        className="fill-green-500 stroke-background"
        strokeWidth={2}
      />
      <text
        x={Math.min(toX(last.time), CHART_WIDTH - 24)}
        y={Math.max(toY(last.percent) - 8, 10)}
        textAnchor="end"
        className="fill-black/70 text-[9px] font-medium dark:fill-white/70"
      >
        {last.percent}%
      </text>
    </svg>
  );
}
