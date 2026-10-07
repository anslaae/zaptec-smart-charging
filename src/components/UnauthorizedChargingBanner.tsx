// Surfaces scheduler_heartbeat.lastBlockedAt -- set whenever a scheduler tick
// found a charger drawing power with no active schedule or manual
// authorization behind it and force-stopped it (see enforceAuthorizedCharging
// in src/lib/scheduler/run.ts). Only shown for a while after the fact since
// otherwise a single old event would sit here forever looking current.
const SHOWN_FOR_HOURS = 24;

export function UnauthorizedChargingBanner({
  lastBlockedAt,
  chargerName,
}: {
  lastBlockedAt: Date | null;
  chargerName: string | null;
}) {
  if (!lastBlockedAt) return null;
  const hoursAgo = (new Date().getTime() - lastBlockedAt.getTime()) / 3_600_000;
  if (hoursAgo > SHOWN_FOR_HOURS) return null;

  const when = lastBlockedAt.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
      <p className="font-medium">Stopped an unrecognized charging session</p>
      <p className="mt-0.5 text-amber-700/80 dark:text-amber-400/80">
        {chargerName ?? "A charger"} started charging on its own (not from a plan or manual
        start) on {when}. It was stopped automatically.
      </p>
    </div>
  );
}
