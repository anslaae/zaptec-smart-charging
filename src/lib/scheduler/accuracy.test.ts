import { describe, expect, it } from "vitest";
import { evaluateScheduleAccuracy } from "./accuracy";

const base = {
  readyBy: new Date("2026-01-01T07:00:00Z"),
  startedAt: new Date("2026-01-01T05:00:00Z"),
  targetEnergyKwh: 20,
  deliveredEnergyKwh: 20,
  wasPaused: false,
};

describe("evaluateScheduleAccuracy", () => {
  it("reports an early, exactly-as-estimated finish", () => {
    const result = evaluateScheduleAccuracy({
      ...base,
      finishedAt: new Date("2026-01-01T06:48:00Z"), // 108 min after start
      estimatedDurationMinutes: 108,
    });
    expect(result.finishedMinutesBeforeReadyBy).toBe(12);
    expect(result.actualDurationMinutes).toBe(108);
    expect(result.durationDeltaMinutes).toBe(0);
    expect(result.summary).toContain("12m before the ready-by deadline");
    expect(result.summary).toContain("matched the estimated duration");
  });

  it("reports a late finish and a longer-than-estimated duration", () => {
    const result = evaluateScheduleAccuracy({
      ...base,
      finishedAt: new Date("2026-01-01T07:15:00Z"), // 135 min after start, 15 min late
      estimatedDurationMinutes: 108,
    });
    expect(result.finishedMinutesBeforeReadyBy).toBe(-15);
    expect(result.durationDeltaMinutes).toBe(27);
    expect(result.summary).toContain("15m after the ready-by deadline");
    expect(result.summary).toContain("27m longer than estimated");
  });

  it("reports a faster-than-estimated duration", () => {
    const result = evaluateScheduleAccuracy({
      ...base,
      finishedAt: new Date("2026-01-01T06:30:00Z"), // 90 min after start
      estimatedDurationMinutes: 108,
    });
    expect(result.durationDeltaMinutes).toBe(-18);
    expect(result.summary).toContain("18m faster than estimated");
  });

  it("omits the duration comparison when there's no estimate", () => {
    const result = evaluateScheduleAccuracy({
      ...base,
      finishedAt: new Date("2026-01-01T06:48:00Z"),
      estimatedDurationMinutes: null,
    });
    expect(result.durationDeltaMinutes).toBeNull();
    expect(result.summary).not.toContain("estimated duration");
    expect(result.summary).not.toContain("than estimated");
  });

  it("notes when the session was paused and resumed", () => {
    const result = evaluateScheduleAccuracy({
      ...base,
      finishedAt: new Date("2026-01-01T06:48:00Z"),
      estimatedDurationMinutes: 108,
      wasPaused: true,
    });
    expect(result.summary).toContain("includes paused time");
  });

  it("computes delivered vs. target energy delta", () => {
    const result = evaluateScheduleAccuracy({
      ...base,
      finishedAt: new Date("2026-01-01T06:48:00Z"),
      estimatedDurationMinutes: null,
      deliveredEnergyKwh: 20.3,
    });
    expect(result.deliveredVsTargetKwh).toBe(0.3);
  });
});
