import { describe, expect, it } from "vitest";
import {
  incidentPush,
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
    expect(p.body).toBe("Batteri 41\u202F% (målt 21:12). Trykk for å planlegge lading.");
    expect(p.tag).toBe("charger-c1");
    expect(p.actions?.map((a) => a.url)).toEqual(["/?sheet=plan", "/?action=charge-now"]);
  });

  it("plug-in without a battery reading uses the fallback body", () => {
    expect(pluggedInNoPlan({ chargerId: "c1", battery: null }).body).toBe("Trykk for å planlegge lading.");
  });

  it("plan started uses % when known, kWh otherwise", () => {
    const finishTime = new Date("2026-11-11T05:45:00Z");
    expect(planStarted({ scheduleId: "s", targetPercent: 80, targetKwh: 15.6, finishTime }).body).toBe(
      "Lader til 80\u202F%, ferdig ca. 06:45.",
    );
    expect(planStarted({ scheduleId: "s", targetPercent: null, targetKwh: 15.6, finishTime }).body).toBe(
      "Lader 15,6 kWh, ferdig ca. 06:45.",
    );
  });

  it("plan completed shows reached %, kWh and cost", () => {
    const p = planCompleted({ scheduleId: "s", targetPercent: 80, deliveredKwh: 15.62, costNok: 7.81 });
    expect(p.body).toMatch(/^Ladet til ca\. 80\u202F% · 15,6 kWh · ca\. \d+ kr\.$/);
    expect(p.url).toBe("/history");
  });
});

describe("D75 incident pushes (notifications.nb.json)", () => {
  const nnbsp = " ";
  it("one tag per incident", () => {
    expect(incidentPush({ incidentId: "i1", kind: "locked" })).toMatchObject({
      title: "Laderen stoppet for mange ganger",
      body: "Koble bilen fra og til igjen for å lade.",
      tag: "incident-i1",
      url: "/",
    });
  });
  it("car cases, with a narrow no-break space before %", () => {
    expect(incidentPush({ incidentId: "i", kind: "car", carCase: "full", percent: 96.4, kwh: 12.34 }).body).toBe(
      `Sluttet å lade ved 96${nnbsp}% · 12,3 kWh.`,
    );
    expect(incidentPush({ incidentId: "i", kind: "car", carCase: "stopped", percent: 64, kwh: 5 })).toMatchObject({
      title: "Bilen sluttet å lade",
      body: `Stoppet ved 64${nnbsp}%. Sjekk ladegrensen eller timeren i bilen.`,
    });
    expect(incidentPush({ incidentId: "i", kind: "car", carCase: "never", minutes: 5 })).toMatchObject({
      title: "Bilen lader ikke",
      body: "Ingen strøm etter 5 min. Sjekk kabelen og bilens timer.",
    });
    expect(incidentPush({ incidentId: "i", kind: "car", carCase: "declinedPlan", percent: null }).body).toMatch(/^Stoppet ved –/);
  });
  it("faults", () => {
    expect(incidentPush({ incidentId: "i", kind: "start_failed", time: new Date("2026-11-13T01:40:00Z") }).body).toBe(
      "Laderen startet ikke kl. 02:40. Sjekk laderen, eller prøv igjen i appen.",
    );
    expect(incidentPush({ incidentId: "i", kind: "offline", since: new Date("2026-11-13T01:40:00Z") }).title).toBe("Laderen svarer ikke");
    expect(incidentPush({ incidentId: "i", kind: "charger_warning", warning: "jordfeil" }).body).toBe("Jordfeil. Ladingen er stoppet.");
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
