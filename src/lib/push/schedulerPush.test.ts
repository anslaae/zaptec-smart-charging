import { describe, expect, it } from "vitest";
import { planCompleted, smartStarted } from "./notifications";

// D86/D87 push copy (design/redesign/notifications.nb.json smart_started, plan_completed bodyMeasured).
describe("scheduler pushes (D86/D87)", () => {
  it("smart_started: target % and finish time, Smart's tag", () => {
    const p = smartStarted({ scheduleId: "s1", targetPercent: 80, finishTime: new Date("2026-11-20T03:15:00Z") });
    expect(p.title).toBe("Smart lading har startet");
    expect(p.body).toBe("Lader til 80 %, ferdig ca. 04:15.");
    expect(p.tag).toBe("smart-s1");
    expect(p.event).toBe("smart_started");
  });

  it("plan_completed states the car's reading when that ended the plan", () => {
    const measured = planCompleted({ scheduleId: "p1", targetPercent: 81, measuredPercent: 81, deliveredKwh: 10.45, costNok: 12 });
    expect(measured.body).toBe("Bilen meldte 81 % · 10,5 kWh · ca. 12 kr.");
    expect(measured.tag).toBe("plan-p1");
    const estimated = planCompleted({ scheduleId: "p1", targetPercent: 80, deliveredKwh: 10.45, costNok: 12 });
    expect(estimated.body).toBe("Ladet til ca. 80 % · 10,5 kWh · ca. 12 kr.");
    expect(estimated.event).toBe("plan_completed");
  });
});
