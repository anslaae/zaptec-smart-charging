// Pure, unit-testable (no "server-only", no DB) -- mirrors engine.ts. Run
// once when a planned charge completes, to answer "did we estimate the
// charging time well," logged as the detail on the PlanCompleted activity
// event (see run.ts).

export interface ScheduleAccuracyInput {
  readyBy: Date;
  startedAt: Date;
  finishedAt: Date;
  /** estimateChargingPlan()'s predicted duration, captured once at the moment charging actually started. Null for schedules created before this existed. */
  estimatedDurationMinutes: number | null;
  targetEnergyKwh: number;
  deliveredEnergyKwh: number;
  /** True if this schedule was paused and resumed by the scheduler at least once -- the actual duration below then includes that paused time, not just active charging. */
  wasPaused: boolean;
}

export interface ScheduleAccuracyResult {
  /** Positive = finished before the deadline, negative = finished late. */
  finishedMinutesBeforeReadyBy: number;
  actualDurationMinutes: number;
  /** actualDurationMinutes - estimatedDurationMinutes; null if there was no estimate to compare against. */
  durationDeltaMinutes: number | null;
  deliveredVsTargetKwh: number;
  summary: string;
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

export function evaluateScheduleAccuracy(input: ScheduleAccuracyInput): ScheduleAccuracyResult {
  const finishedMinutesBeforeReadyBy = Math.round(
    (input.readyBy.getTime() - input.finishedAt.getTime()) / 60_000,
  );
  const actualDurationMinutes = Math.round(
    (input.finishedAt.getTime() - input.startedAt.getTime()) / 60_000,
  );
  const durationDeltaMinutes =
    input.estimatedDurationMinutes != null
      ? actualDurationMinutes - input.estimatedDurationMinutes
      : null;
  const deliveredVsTargetKwh =
    Math.round((input.deliveredEnergyKwh - input.targetEnergyKwh) * 10) / 10;

  const timing =
    finishedMinutesBeforeReadyBy >= 0
      ? `Finished ${formatMinutes(finishedMinutesBeforeReadyBy)} before the ready-by deadline`
      : `Finished ${formatMinutes(-finishedMinutesBeforeReadyBy)} after the ready-by deadline`;

  const durationNote =
    durationDeltaMinutes == null
      ? ""
      : durationDeltaMinutes === 0
        ? " (matched the estimated duration)"
        : durationDeltaMinutes > 0
          ? ` (took ${formatMinutes(durationDeltaMinutes)} longer than estimated)`
          : ` (finished ${formatMinutes(-durationDeltaMinutes)} faster than estimated)`;

  const pausedNote = input.wasPaused ? " -- includes paused time" : "";

  return {
    finishedMinutesBeforeReadyBy,
    actualDurationMinutes,
    durationDeltaMinutes,
    deliveredVsTargetKwh,
    summary: `${timing}${durationNote}${pausedNote}`,
  };
}
