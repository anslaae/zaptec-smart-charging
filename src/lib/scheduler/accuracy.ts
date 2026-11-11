// Pure, unit-testable (no "server-only", no DB) -- mirrors engine.ts. Run
// once when a planned charge completes, to answer "did we estimate the
// charging time well," logged as the detail on the PlanCompleted activity
// event (see run.ts). The note is shown in Aktivitet, so it's Norwegian.

import { formatDuration } from "@/lib/datetime";
import { fill, nb } from "@/lib/i18n/nb";

const t = nb.accuracy;

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
  return formatDuration(minutes * 60);
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
      ? fill(t.before, { duration: formatMinutes(finishedMinutesBeforeReadyBy) })
      : fill(t.after, { duration: formatMinutes(-finishedMinutesBeforeReadyBy) });

  const durationNote =
    durationDeltaMinutes == null
      ? ""
      : durationDeltaMinutes === 0
        ? t.asEstimated
        : durationDeltaMinutes > 0
          ? fill(t.slower, { duration: formatMinutes(durationDeltaMinutes) })
          : fill(t.faster, { duration: formatMinutes(-durationDeltaMinutes) });

  const pausedNote = input.wasPaused ? t.paused : "";

  return {
    finishedMinutesBeforeReadyBy,
    actualDurationMinutes,
    durationDeltaMinutes,
    deliveredVsTargetKwh,
    summary: `${timing}${durationNote}${pausedNote}`,
  };
}
