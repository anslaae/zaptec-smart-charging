import { describe, expect, it } from "vitest";
import { cancelPlanDialog, lendDialog, planCancelledToast, stopChargingDialog } from "./dialogs";

const now = new Date("2026-11-10T20:00:00Z"); // Tue 21:00 Oslo
const plan = { targetPercent: 80, targetKwh: 15.6, readyByIso: "2026-11-11T06:30:00Z" };

describe("dialogs (strings.nb.json → dialogs)", () => {
  it("Avbryt plan names exactly what is removed", () => {
    const d = cancelPlanDialog(plan, now);
    expect(d.body).toBe("80\u202F% klar 07:30 i morgen slettes. Bilen lader ikke før du lager en ny plan eller trykker Lad nå.");
    expect([d.safeLabel, d.actionLabel, d.tone]).toEqual(["Behold", "Avbryt plan", "danger"]);
    expect(cancelPlanDialog({ ...plan, targetPercent: null }, now).body).toMatch(/^15,6 kWh klar 07:30/);
    expect(planCancelledToast(plan, now).body).toBe("80\u202F% klar i morgen 07:30");
  });

  it("Stopp lading only states a battery % when it's known", () => {
    expect(stopChargingDialog({ kwh: 4.2, percent: 63 }).body).toMatch(/^Bilen har fått 4,2 kWh og er på ca\. 63\u202F%/);
    expect(stopChargingDialog({ kwh: 4.2, percent: null }).body).toBe("Bilen har fått 4,2 kWh. Den lader ikke mer før du starter igjen.");
  });

  it("lending mentions the plan it cancels", () => {
    expect(lendDialog("Opel Mokka-e", null).body).not.toMatch(/blir avbrutt/);
    expect(lendDialog("Opel Mokka-e", "i morgen 07:30").body).toMatch(/Planen \(klar i morgen 07:30\) blir avbrutt\.$/);
    expect(lendDialog("Opel Mokka-e", null).textField?.name).toBe("guestName");
  });
});
