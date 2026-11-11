import { describe, expect, it } from "vitest";
import {
  lateEstimate,
  planCompleted,
  planStarted,
  pluggedInNoPlan,
  reachedPercent,
  shouldRemindWaitingForCar,
} from "./notifications";

const now = new Date("2026-11-10T21:00:00Z");

describe("push payloads", () => {
  it("plug-in without plan offers Planlegg and Lad nå", () => {
    const p = pluggedInNoPlan({ chargerId: "c1", battery: { percent: 41.4, measuredAt: new Date("2026-11-10T20:12:00Z") } });
    expect(p.body).toBe("Batteri 41 % (målt 21:12). Trykk for å planlegge lading.");
    expect(p.tag).toBe("charger-c1");
    expect(p.actions?.map((a) => a.url)).toEqual(["/?sheet=plan", "/?action=charge-now"]);
  });

  it("plug-in without a battery reading uses the fallback body", () => {
    expect(pluggedInNoPlan({ chargerId: "c1", battery: null }).body).toBe("Trykk for å planlegge lading.");
  });

  it("plan started uses % when known, kWh otherwise", () => {
    const finishTime = new Date("2026-11-11T05:45:00Z");
    expect(planStarted({ scheduleId: "s", targetPercent: 80, targetKwh: 15.6, finishTime }).body).toBe(
      "Lader til 80 %, ferdig ca. 06:45.",
    );
    expect(planStarted({ scheduleId: "s", targetPercent: null, targetKwh: 15.6, finishTime }).body).toBe(
      "Lader 15,6 kWh, ferdig ca. 06:45.",
    );
  });

  it("plan completed shows reached %, kWh and cost", () => {
    const p = planCompleted({ scheduleId: "s", targetPercent: 80, deliveredKwh: 15.62, costNok: 7.81 });
    expect(p.body).toMatch(/^Ladet til ca\. 80 % · 15,6 kWh · ca\. \d+ kr\.$/);
    expect(p.url).toBe("/history");
  });
});

describe("plan warnings", () => {
  it("reminds once, 30 min before the latest start, only without a car", () => {
    const latestStart = new Date(now.getTime() + 20 * 60_000);
    expect(shouldRemindWaitingForCar({ now, latestStart, connected: false, alreadyNotified: false })).toBe(true);
    expect(shouldRemindWaitingForCar({ now, latestStart, connected: true, alreadyNotified: false })).toBe(false);
    expect(shouldRemindWaitingForCar({ now, latestStart, connected: false, alreadyNotified: true })).toBe(false);
    const later = new Date(now.getTime() + 45 * 60_000);
    expect(shouldRemindWaitingForCar({ now, latestStart: later, connected: false, alreadyNotified: false })).toBe(false);
  });

  it("flags a plan that can't finish by readyBy and estimates the % it reaches", () => {
    const readyBy = new Date(now.getTime() + 60 * 60_000);
    const result = lateEstimate({
      now,
      readyBy,
      remainingKwh: 10,
      powerKw: 5,
      deliveredKwh: 4.6,
      startPercent: 40,
      capacityKwh: 46,
    });
    expect(result).toEqual({ late: true, expectedPercent: 61 });
    expect(lateEstimate({ now, readyBy, remainingKwh: 4, powerKw: 5, deliveredKwh: 0, startPercent: 40, capacityKwh: 46 }).late).toBe(false);
  });

  it("reached % comes from start % plus delivered energy", () => {
    expect(reachedPercent({ startPercent: 41, targetPercent: 80, deliveredKwh: 17.9, capacityKwh: 46 })).toBe(80);
    expect(reachedPercent({ startPercent: null, targetPercent: 80, deliveredKwh: 1, capacityKwh: 46 })).toBe(80);
  });
});
