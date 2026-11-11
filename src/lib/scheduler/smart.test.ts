import { describe, expect, it } from "vitest";
import { decideSmart, isHhmm, nextSmartReadyBy, planSmartCharge } from "./smart";
import { priceAt } from "@/lib/pricing";

// Elvia + Norgespris (HANDOFF §6b)
const prices = { energyNokPerKwh: 0.5, gridDayNokPerKwh: 0.464, gridNightNokPerKwh: 0.314 };
const priceFn = (d: Date) => priceAt(d, prices);
const osloTime = (iso: string) =>
  new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Oslo" }).format(
    new Date(iso),
  );

describe("planSmartCharge", () => {
  it("plugged in at 17:30 on a weekday: charges in the night window, ending at the deadline", () => {
    // Tue 10 Nov 2026 17:30 Oslo → ready Wed 07:30; 46 kWh × (80−46) % = 15,6 kWh at 7 kW ≈ 2 t 14 min
    const plan = planSmartCharge({
      now: new Date("2026-11-10T16:30:00Z"),
      socPercent: 46,
      targetPercent: 80,
      capacityKwh: 46,
      powerKw: 7,
      readyBy: new Date("2026-11-11T06:30:00Z"),
      priceFn,
    });
    expect(plan.neededKwh).toBe(15.6);
    expect(plan.late).toBe(false);
    expect(plan.blocks).toHaveLength(1);
    // Cheapest = night (22–06); ties → latest, so it ends at 06:00 when the day rate starts
    expect(osloTime(plan.blocks[0].end)).toBe("06:00");
    expect(osloTime(plan.blocks[0].start)).toBe("03:46");
    expect(plan.costNok).toBeCloseTo(15.6 * 0.814, 1);
    // Charging at once (17:30, evening, day rate) would cost more
    expect(plan.nowCostNok).toBeGreaterThan(plan.costNok);
  });

  it("never uses the evening peak when off-peak time is enough", () => {
    const plan = planSmartCharge({
      now: new Date("2026-11-10T14:00:00Z"), // 15:00
      socPercent: 70,
      targetPercent: 80,
      capacityKwh: 46,
      powerKw: 7,
      readyBy: new Date("2026-11-10T21:30:00Z"), // 22:30
      priceFn,
    });
    for (const b of plan.blocks) {
      const start = Number(osloTime(b.start).slice(0, 2));
      const end = osloTime(b.end);
      expect(start >= 16 && start < 21).toBe(false);
      expect(end <= "16:00" || end >= "21:00").toBe(true);
    }
  });

  it("uses all off-peak time before any evening-peak hour, even at the same price", () => {
    // Weekday 14:00 → 20:00: only 14–16 is off-peak, all at the day rate like the peak hours.
    // 16,1 kWh at 7 kW = 2 t 18 min: all of 14–16, then only the missing 18 min from the peak.
    const plan = planSmartCharge({
      now: new Date("2026-11-10T13:00:00Z"),
      socPercent: 50,
      targetPercent: 85,
      capacityKwh: 46,
      powerKw: 7,
      readyBy: new Date("2026-11-10T19:00:00Z"),
      priceFn,
    });
    expect(plan.blocks.map((b) => `${osloTime(b.start)}–${osloTime(b.end)}`)).toEqual(["14:00–16:00", "19:42–20:00"]);
  });

  it("uses every slot and flags late when there isn't time", () => {
    const plan = planSmartCharge({
      now: new Date("2026-11-11T05:00:00Z"),
      socPercent: 20,
      targetPercent: 100,
      capacityKwh: 46,
      powerKw: 7,
      readyBy: new Date("2026-11-11T06:30:00Z"),
      priceFn,
    });
    expect(plan.late).toBe(true);
    expect(plan.blocks).toEqual([{ start: "2026-11-11T05:00:00.000Z", end: "2026-11-11T06:30:00.000Z" }]);
  });

  it("plans nothing when the battery is already at the target", () => {
    const plan = planSmartCharge({
      now: new Date("2026-11-10T16:30:00Z"),
      socPercent: 85,
      targetPercent: 80,
      capacityKwh: 46,
      powerKw: 7,
      readyBy: new Date("2026-11-11T06:30:00Z"),
      priceFn,
    });
    expect(plan.blocks).toEqual([]);
  });
});

describe("nextSmartReadyBy", () => {
  it("weekday evening → tomorrow 07:30; Friday evening → Saturday 10:00", () => {
    expect(nextSmartReadyBy(new Date("2026-11-10T16:00:00Z"), "07:30", "10:00").toISOString()).toBe("2026-11-11T06:30:00.000Z");
    expect(nextSmartReadyBy(new Date("2026-11-13T18:00:00Z"), "07:30", "10:00").toISOString()).toBe("2026-11-14T09:00:00.000Z");
  });

  it("uses the weekend time on a public holiday (17 May 2027 is a Monday)", () => {
    expect(nextSmartReadyBy(new Date("2027-05-16T18:00:00Z"), "07:30", "10:00").toISOString()).toBe("2027-05-17T08:00:00.000Z");
  });

  it("early morning before the deadline → today", () => {
    expect(nextSmartReadyBy(new Date("2026-11-11T04:00:00Z"), "07:30", "10:00").toISOString()).toBe("2026-11-11T06:30:00.000Z");
  });
});

describe("decideSmart", () => {
  const blocks = [{ start: "2026-11-11T02:46:00.000Z", end: "2026-11-11T05:00:00.000Z" }];
  it("waits before the block, charges in it and after it while short, completes at target", () => {
    expect(decideSmart({ blocks, now: new Date("2026-11-11T01:00:00Z"), deliveredKwh: 0, targetKwh: 15.6 })).toBe("wait");
    expect(decideSmart({ blocks, now: new Date("2026-11-11T03:00:00Z"), deliveredKwh: 1, targetKwh: 15.6 })).toBe("charge");
    expect(decideSmart({ blocks, now: new Date("2026-11-11T05:30:00Z"), deliveredKwh: 14, targetKwh: 15.6 })).toBe("charge");
    expect(decideSmart({ blocks, now: new Date("2026-11-11T04:00:00Z"), deliveredKwh: 15.6, targetKwh: 15.6 })).toBe("complete");
  });
});

describe("isHhmm", () => {
  it("accepts 24h times and nothing else", () => {
    expect(["07:30", "00:00", "23:59"].every(isHhmm)).toBe(true);
    expect(["7:30", "24:00", "07:60", "0730", "07:30x"].some(isHhmm)).toBe(false);
  });
});
