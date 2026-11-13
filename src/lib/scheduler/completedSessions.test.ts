import { describe, expect, it } from "vitest";
import { exactRowEnergy } from "./completedSessions";

const completed = { sessionId: "s1", endedAt: new Date("2026-11-13T09:16:41Z"), energyKwh: 10.242 };

describe("exactRowEnergy (D72)", () => {
  it("raises a row closed by the unplug tick to the exact final energy", () => {
    expect(
      exactRowEnergy(
        { zaptecSessionId: "s1", startEnergyKwh: "2.00", lastObservedEnergyKwh: "9.90", endedAt: new Date("2026-11-13T09:17:30Z") },
        completed,
      ),
    ).toEqual({ lastObservedEnergyKwh: "10.24", energyKwh: "8.24" });
  });

  it("updates only the reading of a row that is still open", () => {
    expect(
      exactRowEnergy({ zaptecSessionId: "s1", startEnergyKwh: "0.00", lastObservedEnergyKwh: "9.90", endedAt: null }, completed),
    ).toEqual({ lastObservedEnergyKwh: "10.24", energyKwh: null });
  });

  it("leaves a row closed before the session ended (Stopp, then a new row)", () => {
    expect(
      exactRowEnergy(
        { zaptecSessionId: "s1", startEnergyKwh: "0.00", lastObservedEnergyKwh: "4.00", endedAt: new Date("2026-11-13T07:00:00Z") },
        completed,
      ),
    ).toBeNull();
  });

  it("ignores rows on other sessions, and never lowers a reading", () => {
    expect(
      exactRowEnergy({ zaptecSessionId: "s2", startEnergyKwh: "0", lastObservedEnergyKwh: "1", endedAt: null }, completed),
    ).toBeNull();
    expect(
      exactRowEnergy({ zaptecSessionId: "s1", startEnergyKwh: "0", lastObservedEnergyKwh: "10.50", endedAt: null }, completed),
    ).toBeNull();
  });

  it("fills a row that was bound but never read", () => {
    expect(
      exactRowEnergy({ zaptecSessionId: "s1", startEnergyKwh: "1.00", lastObservedEnergyKwh: null, endedAt: completed.endedAt }, completed),
    ).toEqual({ lastObservedEnergyKwh: "10.24", energyKwh: "9.24" });
  });
});
