import { describe, expect, it } from "vitest";
import { latestOdometer, monthDriving, type DriveReading } from "./driving";

const r = (iso: string, odometerKm: number | null, batteryPercent: number | null): DriveReading => ({
  at: new Date(iso),
  odometerKm,
  batteryPercent,
});
const CAP = 46;

describe("monthDriving", () => {
  it("returns no km and not enough data for a month without readings", () => {
    const d = monthDriving([r("2026-10-20T10:00:00Z", 18000, 60)], [], "2026-11", CAP, 0.6);
    expect(d.km).toBeNull();
    expect(d.enough).toBe(false);
    expect(d.kwhPerMil).toBeNull();
    expect(d.awayCharges).toBe(0);
  });

  it("measures km from the last reading before the month, consumption from sparse battery drops", () => {
    const readings = [
      r("2026-10-31T18:00:00Z", 18000, 90),
      r("2026-11-03T07:00:00Z", 18060, 79), // 60 km, −11 %
      r("2026-11-05T16:00:00Z", 18150, 63), // 90 km, −16 %
      r("2026-11-06T09:00:00Z", 18150, 62), // parked: drain, not counted
    ];
    const d = monthDriving(readings, [], "2026-11", CAP, 0.6);
    expect(d.km).toBe(150);
    expect(d.enough).toBe(true);
    expect(d.socDropPercent).toBe(27);
    const kwh = 0.27 * CAP; // 12.42
    expect(d.kmPerKwh).toBeCloseTo(150 / kwh, 5);
    expect(d.kwhPerMil).toBeCloseTo((kwh / 150) * 10, 5);
    expect(d.nokPerMil).toBeCloseTo((kwh / 150) * 10 * 0.6, 5);
  });

  it("uses the first reading in the month when there is none before", () => {
    const d = monthDriving([r("2026-11-02T08:00:00Z", 100, 80), r("2026-11-09T08:00:00Z", 140, 72)], [], "2026-11", CAP, 0.6);
    expect(d.km).toBe(40);
    expect(d.enough).toBe(false); // < 100 km
  });

  it("leaves pairs with a home session out of consumption, and counts away charges", () => {
    const home = [{ startedAt: new Date("2026-11-04T20:00:00Z"), endedAt: new Date("2026-11-05T05:00:00Z") }];
    const readings = [
      r("2026-11-01T08:00:00Z", 1000, 80),
      r("2026-11-03T08:00:00Z", 1080, 65), // counted: 80 km, −15 %
      r("2026-11-05T08:00:00Z", 1100, 85), // rose with home session: skipped
      r("2026-11-07T08:00:00Z", 1160, 74), // counted: 60 km, −11 %
      r("2026-11-08T12:00:00Z", 1300, 70), // rose? no: −4 % over 140 km, counted
      r("2026-11-09T12:00:00Z", 1350, 90), // rose, no home session: away charge
    ];
    const d = monthDriving(readings, home, "2026-11", CAP, null);
    expect(d.km).toBe(350);
    expect(d.awayCharges).toBe(1);
    expect(d.socDropPercent).toBe(30);
    expect(d.kmPerKwh).toBeCloseTo(280 / (0.3 * CAP), 5);
    expect(d.nokPerMil).toBeNull(); // no price
  });

  it("does not count a battery drop across a home session", () => {
    const home = [{ startedAt: new Date("2026-11-02T20:00:00Z"), endedAt: null }];
    const d = monthDriving([r("2026-11-01T08:00:00Z", 0, 80), r("2026-11-03T08:00:00Z", 200, 50)], home, "2026-11", CAP, 0.6);
    expect(d.km).toBe(200);
    expect(d.socDropPercent).toBe(0);
    expect(d.enough).toBe(false);
  });

  it("assigns readings to months in Oslo time", () => {
    // 23:30 UTC on 31 Oct is 00:30 on 1 Nov in Oslo.
    const d = monthDriving([r("2026-10-31T23:30:00Z", 500, 70), r("2026-11-02T10:00:00Z", 520, 68)], [], "2026-11", CAP, 0.6);
    expect(d.km).toBe(20);
  });
});

describe("latestOdometer", () => {
  it("takes the newest reading up to the end of the month", () => {
    const t = [r("2026-10-01T08:00:00Z", 10, 50), r("2026-11-03T08:00:00Z", 30, 50), r("2026-12-01T08:00:00Z", 60, 50)];
    expect(latestOdometer(t, "2026-11")).toEqual({ km: 30, at: new Date("2026-11-03T08:00:00Z") });
    expect(latestOdometer([], "2026-11")).toBeNull();
  });
});
