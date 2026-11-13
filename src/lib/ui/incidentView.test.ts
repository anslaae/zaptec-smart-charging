import { describe, expect, it } from "vitest";
import { incidentView, type IncidentData } from "./incidentView";
import { activityText } from "./activity";
import { nb } from "@/lib/i18n/nb";

const now = new Date("2026-11-13T20:40:00Z");
const incident = (overrides: Partial<IncidentData>): IncidentData => ({
  id: "i1",
  kind: "car",
  carCase: "stopped",
  sinceIso: "2026-11-13T20:30:00Z",
  subject: "session",
  requestedAtIso: "2026-11-13T19:30:00Z",
  detail: null,
  retried: false,
  autoEndAtIso: null,
  ...overrides,
});
const view = (i: Partial<IncidentData>, chargeSeconds: number | null = 3600) =>
  incidentView({ incident: incident(i), now, chargeSeconds, remainingSeconds: 5400 });

describe("incidentView (HANDOFF §6e)", () => {
  it("case 2: amber card with myOpel, 'Avslutt ladingen'", () => {
    const v = view({});
    expect(v).toMatchObject({ status: "Bilen sluttet å lade", sub: "Kl. 21:30, etter 1 t lading", badge: "warning", stopLabel: "Avslutt ladingen" });
    expect(v.card).toMatchObject({ tone: "declined", title: "Trolig bilens ladegrense eller timer", myOpel: true, retry: false });
  });

  it("case 1: calm -- no card, a check badge and when it ends itself", () => {
    const v = view({ carCase: "full", autoEndAtIso: "2026-11-13T21:00:00Z" });
    expect(v).toMatchObject({ status: "Bilen er trolig full", card: null, badge: "check" });
    expect(v.hint).toBe("Ladingen avsluttes av seg selv kl. 22:00 hvis bilen ikke tar mer strøm.");
  });

  it("case 3: a neutral info card and a pause badge; case 4 from the tap", () => {
    expect(view({ carCase: "idle" })).toMatchObject({ sub: "Har ikke ladet siden 21:30 · 10 min", badge: "pause", card: { tone: "calm" } });
    expect(view({ carCase: "never" }).sub).toBe("Startet 20:30 · 0 kWh på 70 min");
  });

  it("faults: danger card, check list, one Prøv igjen (gone once used, never for the lock)", () => {
    const failed = view({ kind: "start_failed", carCase: null, subject: "schedule", detail: { count: 3, from: "02:39", to: "02:41" } });
    expect(failed.card).toMatchObject({ tone: "fault", checklist: true, retry: true, body: "Jeg prøvde 3 ganger 02:39–02:41 og venter nå, så laderen ikke blir sperret." });
    expect(failed.sub).toBe("Stoppet 21:30 · trenger ca. 1 t 30 min til");
    expect(view({ kind: "offline", carCase: null, retried: true }).card?.retry).toBe(false);
    expect(view({ kind: "locked", carCase: null, subject: "charger" }).card).toMatchObject({ retry: false, checklist: false });
    expect(view({ kind: "charger_warning", carCase: null, detail: { warning: "jordfeil" } }).card?.body).toBe("Jordfeil. Ladingen er stoppet.");
  });

  it("a plan keeps its own button (no stop label)", () => {
    expect(view({ carCase: "declinedPlan", subject: "schedule" }).stopLabel).toBeNull();
  });
});

describe("activityText (D75 lines)", () => {
  it("fills a label's placeholders from the event's JSON detail", () => {
    expect(activityText({ type: "car_stopped", detail: JSON.stringify({ percent: 64 }) }, nb.activity)).toBe("Bilen sluttet å lade – 64 %");
    expect(activityText({ type: "retry", detail: JSON.stringify({ name: "Roger" }) }, nb.activity)).toBe("Prøvde igjen (Roger)");
    expect(activityText({ type: "car_stopped", detail: null }, nb.activity)).toBe("Bilen sluttet å lade – – %");
    expect(activityText({ type: "plugged_in", detail: "x" }, nb.activity)).toBe("Bil koblet til");
  });
});
