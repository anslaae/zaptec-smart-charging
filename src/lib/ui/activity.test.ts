import { describe, expect, it } from "vitest";
import { visibleActivity } from "./activity";

const e = (iso: string, type: string, userId: string | null = null) => ({ createdAt: new Date(iso), type, userId });

describe("visibleActivity", () => {
  it("flags the charger's own start/stop and the automatic stop as technical", () => {
    const out = visibleActivity([
      e("2026-11-12T14:40:28Z", "charging_stopped"),
      e("2026-11-12T14:39:10Z", "plugged_in"),
      e("2026-11-12T14:39:09Z", "stopped_unplanned"),
    ]);
    expect(out.map((r) => [r.event.type, r.technical])).toEqual([
      ["charging_stopped", true],
      ["plugged_in", false],
      ["stopped_unplanned", true],
    ]);
  });

  it("shows a repeated event within a minute once, keeping the newest", () => {
    const out = visibleActivity([
      e("2026-11-10T17:10:24Z", "manual_start", "roger"),
      e("2026-11-10T17:10:02Z", "manual_start", "roger"),
      e("2026-11-10T17:08:00Z", "manual_start", "roger"),
    ]).filter((r) => !r.technical);
    expect(out.map((r) => r.event.createdAt.toISOString())).toEqual([
      "2026-11-10T17:10:24.000Z",
      "2026-11-10T17:08:00.000Z",
    ]);
  });

  it("keeps the same event by two people, and repeats with something in between", () => {
    const twoPeople = visibleActivity([e("2026-11-10T17:10:24Z", "manual_start", "a"), e("2026-11-10T17:10:02Z", "manual_start", "b")]);
    expect(twoPeople).toHaveLength(2);
    const between = visibleActivity([
      e("2026-11-10T17:10:30Z", "manual_start", "a"),
      e("2026-11-10T17:10:20Z", "manual_stop", "a"),
      e("2026-11-10T17:10:02Z", "manual_start", "a"),
    ]);
    expect(between).toHaveLength(3);
  });

  it("collapses repeats even with technical events in between", () => {
    const out = visibleActivity([
      e("2026-11-10T17:19:24Z", "preheat_started", "a"),
      e("2026-11-10T17:19:23Z", "charging_started"),
      e("2026-11-10T17:19:23Z", "preheat_started", "a"),
    ]).filter((r) => !r.technical);
    expect(out).toHaveLength(1);
  });
});
