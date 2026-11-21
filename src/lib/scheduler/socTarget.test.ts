import { describe, expect, it } from "vitest";
import {
  bracketReadings,
  deliveredAtReading,
  drawnKwhBetween,
  learnKwhPerPercent,
  readingDecision,
  type ReadingAction,
  type SocAdjust,
} from "./socTarget";

const t0 = new Date("2026-11-20T22:00:00Z");
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const KPP = 0.46;

function decide(over: Partial<Parameters<typeof readingDecision>[0]> = {}): ReadingAction {
  return readingDecision({
    reading: { percent: 60, oemUpdatedAt: at(30) },
    chargingStartedAt: at(0),
    targetPercent: 80,
    startPercent: 50,
    deliveredKwh: 2.3,
    deliveredAtReadingKwh: 2.3,
    targetKwh: 13.8,
    kwhPerPercent: KPP,
    lastAdjust: null,
    allowRetarget: true,
    now: at(31),
    ...over,
  });
}

describe("readingDecision: stop on reading (D86)", () => {
  it("a reading at/over the target taken after charging started completes", () => {
    expect(decide({ reading: { percent: 80, oemUpdatedAt: at(30) } })).toEqual({ kind: "complete", percent: 80 });
    expect(decide({ reading: { percent: 92, oemUpdatedAt: at(30) } })).toMatchObject({ kind: "complete", percent: 92 });
  });

  it("a reading from before charging started (or within 2 min of it) never counts", () => {
    expect(decide({ reading: { percent: 95, oemUpdatedAt: at(-60) } }).kind).toBe("none");
    expect(decide({ reading: { percent: 95, oemUpdatedAt: at(2) } }).kind).toBe("none");
    expect(decide({ reading: { percent: 95, oemUpdatedAt: at(2.5) } }).kind).toBe("complete");
  });

  it("nothing before the plan has started, or without a reading or target %", () => {
    expect(decide({ chargingStartedAt: null }).kind).toBe("none");
    expect(decide({ reading: null }).kind).toBe("none");
    expect(decide({ targetPercent: null }).kind).toBe("none");
  });

  it("Smart rows stop on a reading but don't retarget here (maybeReplan does)", () => {
    expect(decide({ allowRetarget: false, reading: { percent: 81, oemUpdatedAt: at(30) } }).kind).toBe("complete");
    expect(decide({ allowRetarget: false, reading: { percent: 70, oemUpdatedAt: at(30) } }).kind).toBe("none");
  });
});

describe("readingDecision: drift (D86)", () => {
  it("within 5 points of expected: nothing", () => {
    // expected = 50 + 2.3/0.46 = 55
    expect(decide({ reading: { percent: 59, oemUpdatedAt: at(30) } }).kind).toBe("none");
  });

  it("more than 5 points higher: target = delivered + (target − reading) × kWh/%", () => {
    const a = decide({ reading: { percent: 70, oemUpdatedAt: at(30) }, targetKwh: 8 });
    expect(a).toMatchObject({ kind: "retarget", targetKwh: 2.3 + 10 * KPP });
    // From 13.8 kWh it may only come down 10 points' worth at a time.
    expect(decide({ reading: { percent: 70, oemUpdatedAt: at(30) } })).toMatchObject({ kind: "retarget", targetKwh: Math.round((13.8 - 10 * KPP) * 100) / 100 });
    if (a.kind === "retarget") {
      expect(a.adjust).toEqual({ at: at(31).toISOString(), readingAt: at(30).toISOString(), percent: 70, delivered: 2.3 });
    }
  });

  it("lower than expected raises the target, never above (100 − reading) × kWh/%", () => {
    const a = decide({ reading: { percent: 45, oemUpdatedAt: at(30) } });
    expect(a).toMatchObject({ kind: "retarget", targetKwh: Math.round((2.3 + 35 * KPP) * 100) / 100 });
    const capped = decide({ targetPercent: 100, reading: { percent: 40, oemUpdatedAt: at(30) }, deliveredAtReadingKwh: 2.3 });
    expect(capped).toMatchObject({ kind: "retarget", targetKwh: Math.round((2.3 + 60 * KPP) * 100) / 100 });
  });

  it("drift never completes a plan: it leaves at least 1 point's worth, and lowers by at most 10 points' worth", () => {
    // Reading 76 % taken earlier; since then 2 kWh more: 76 + 2/0.46 ≈ 80 -- but only a reading may end the plan.
    const a = decide({ reading: { percent: 76, oemUpdatedAt: at(30) }, deliveredKwh: 4.3, deliveredAtReadingKwh: 2.3, startPercent: 40 });
    expect(a).toMatchObject({ kind: "retarget", targetKwh: Math.round((13.8 - 10 * KPP) * 100) / 100 });
    const b = decide({ reading: { percent: 79, oemUpdatedAt: at(30) }, deliveredKwh: 9, deliveredAtReadingKwh: 2.3, startPercent: 40, targetKwh: 9.2 });
    expect(b).toMatchObject({ kind: "retarget", targetKwh: Math.round((9 + KPP) * 100) / 100 });
  });

  it("no measured energy at the reading's time: no drift correction (stop on reading still works)", () => {
    expect(decide({ reading: { percent: 70, oemUpdatedAt: at(30) }, deliveredAtReadingKwh: null })).toMatchObject({ why: "no measured energy at the reading" });
    expect(decide({ reading: { percent: 85, oemUpdatedAt: at(30) }, deliveredAtReadingKwh: null }).kind).toBe("complete");
  });

  it("H1: a pause after the reading doesn't fake a drift (20 % -> 80 %, 40 % at 23:00 with 11 kWh, paused to 00:30, 11 kW after)", () => {
    const h = (hhmm: string) => new Date(`2026-11-20T${hhmm}:00Z`);
    const n = (hhmm: string) => new Date(`2026-11-21T${hhmm}:00Z`);
    const kpp = 0.55; // 11 kWh for 20 points
    const log = [
      { observedAt: h("22:00"), operationMode: 3, powerKw: 11 },
      { observedAt: h("23:00"), operationMode: 5, powerKw: 0 },
      { observedAt: n("00:30"), operationMode: 3, powerKw: 11 },
    ];
    const drawn = drawnKwhBetween(log, h("23:00"), n("01:00"))!;
    expect(drawn).toBeCloseTo(5.5, 5);
    const atReading = deliveredAtReading({ deliveredKwh: 16.5, drawnSinceKwh: drawn, floor: 0 })!;
    expect(atReading).toBeCloseTo(11, 5); // the old "11 kW x 2 h since the reading" guess gave 0
    const a = readingDecision({
      reading: { percent: 40, oemUpdatedAt: h("23:00") },
      chargingStartedAt: h("22:00"),
      targetPercent: 80,
      startPercent: 20,
      deliveredKwh: 16.5,
      deliveredAtReadingKwh: atReading,
      targetKwh: 33,
      kwhPerPercent: kpp,
      lastAdjust: null,
      allowRetarget: true,
      now: n("01:00"),
    });
    expect(a.kind).toBe("none"); // 40 % is what was expected at 11 kWh: no retarget, no early stop
    // With the old estimate (0 kWh at the reading) it would still not complete: drift can't end a plan.
    const old = readingDecision({
      reading: { percent: 40, oemUpdatedAt: h("23:00") },
      chargingStartedAt: h("22:00"),
      targetPercent: 80,
      startPercent: 20,
      deliveredKwh: 16.5,
      deliveredAtReadingKwh: 0,
      targetKwh: 33,
      kwhPerPercent: kpp,
      lastAdjust: null,
      allowRetarget: true,
      now: n("01:00"),
    });
    expect(old.kind).not.toBe("complete");
    if (old.kind === "retarget") expect(old.targetKwh).toBeGreaterThanOrEqual(33 - 10 * kpp);
  });

  it("at most once per 10 min, and never twice for the same reading", () => {
    const last: SocAdjust = { at: at(25).toISOString(), readingAt: at(24).toISOString(), percent: 70, delivered: 2 };
    expect(decide({ lastAdjust: last, reading: { percent: 50, oemUpdatedAt: at(30) } })).toMatchObject({ why: "rate limited" });
    expect(decide({ lastAdjust: last, reading: { percent: 50, oemUpdatedAt: at(24) }, now: at(50) })).toMatchObject({ why: "reading already used" });
    expect(decide({ lastAdjust: last, reading: { percent: 50, oemUpdatedAt: at(30) }, now: at(36) }).kind).toBe("retarget");
  });

  it("an automatic session opened without a reading gets its first target from the first fresh one", () => {
    expect(decide({ startPercent: null, targetKwh: null, reading: { percent: 60, oemUpdatedAt: at(30) } })).toMatchObject({
      kind: "retarget",
      targetKwh: Math.round((2.3 + 20 * KPP) * 100) / 100,
    });
    expect(decide({ startPercent: null, targetKwh: 5 }).kind).toBe("none");
  });
});

describe("no start/stop loop from readings (D64/D65)", () => {
  it("90 ticks of flapping, old and repeated readings: no complete, retargets ≤ once per 10 min, never two for one reading", () => {
    let lastAdjust: SocAdjust | null = null;
    let targetKwh = 13.8;
    const retargets: number[] = [];
    let delivered = 0;
    for (let minute = 1; minute <= 90; minute++) {
      delivered += 4.4 / 60;
      const old = minute % 5 === 0;
      const percent = minute % 2 ? 52 : 74; // flapping, never at the 80 % target
      const readingAt = old ? at(-30) : minute % 3 === 0 ? at(minute - 1) : at(minute - 0.5); // some repeats of the previous minute's time
      const a = decide({
        reading: { percent, oemUpdatedAt: readingAt },
        deliveredKwh: delivered,
        deliveredAtReadingKwh: delivered,
        targetKwh,
        lastAdjust,
        now: at(minute),
      });
      expect(a.kind).not.toBe("complete");
      if (a.kind === "retarget") {
        retargets.push(minute);
        expect(Date.parse(a.adjust.readingAt)).toBeGreaterThan(lastAdjust ? Date.parse(lastAdjust.readingAt) : 0);
        expect(a.targetKwh).toBeGreaterThan(delivered);
        lastAdjust = a.adjust;
        targetKwh = a.targetKwh;
      }
    }
    for (let i = 1; i < retargets.length; i++) expect(retargets[i] - retargets[i - 1]).toBeGreaterThanOrEqual(10);
    expect(retargets.length).toBeLessThanOrEqual(9);
  });

  it("the same old reading every tick never does anything", () => {
    for (let minute = 1; minute <= 60; minute++) {
      expect(decide({ reading: { percent: 90, oemUpdatedAt: at(-5) }, now: at(minute) }).kind).toBe("none");
    }
  });
});

describe("deliveredAtReading / drawnKwhBetween", () => {
  it("takes off what the log measured since the reading, within [floor, delivered]", () => {
    expect(deliveredAtReading({ deliveredKwh: 10, drawnSinceKwh: 4, floor: 0 })).toBe(6);
    expect(deliveredAtReading({ deliveredKwh: 3, drawnSinceKwh: 4, floor: 1 })).toBe(1);
    expect(deliveredAtReading({ deliveredKwh: 3, drawnSinceKwh: null, floor: 1 })).toBeNull();
  });

  it("integrates logged power while drawing; null without a row in force at the reading", () => {
    const log = [
      { observedAt: at(0), operationMode: 3, powerKw: 4 },
      { observedAt: at(30), operationMode: 3, powerKw: 2 },
      { observedAt: at(60), operationMode: 5, powerKw: 0 },
    ];
    expect(drawnKwhBetween(log, at(15), at(90))).toBeCloseTo(1 + 1, 5);
    expect(drawnKwhBetween(log, at(-5), at(90))).toBeNull();
  });
});

describe("learned kWh per % (D86)", () => {
  it("median of the newest ≤ 10, needs ≥ 3, clamped to [0.8, 1.2] × capacity/100", () => {
    expect(learnKwhPerPercent([], 46)).toBe(0.46);
    expect(learnKwhPerPercent([{ kwh: 10, deltaPercent: 25 }, { kwh: 10, deltaPercent: 25 }], 46)).toBe(0.46);
    // 19 Nov 0.41, 14 Nov 0.45, 1 Nov 0.46
    const learned = learnKwhPerPercent(
      [
        { kwh: 20.99, deltaPercent: 51 },
        { kwh: 10.45, deltaPercent: 23 },
        { kwh: 24, deltaPercent: 52 },
      ],
      46,
    );
    expect(learned).toBeCloseTo(10.45 / 23, 5);
    expect(learnKwhPerPercent([{ kwh: 5, deltaPercent: 50 }, { kwh: 5, deltaPercent: 50 }, { kwh: 5, deltaPercent: 50 }], 46)).toBeCloseTo(0.368, 5);
    expect(learnKwhPerPercent([{ kwh: 50, deltaPercent: 50 }, { kwh: 50, deltaPercent: 50 }, { kwh: 50, deltaPercent: 50 }], 46)).toBeCloseTo(0.552, 5);
  });

  it("ignores pairs under 5 points apart", () => {
    const tiny = { kwh: 2, deltaPercent: 2 };
    expect(learnKwhPerPercent([tiny, tiny, tiny, tiny], 46)).toBe(0.46);
  });

  it("bracketReadings: latest ≤ 90 min before the start, earliest ≤ 90 min after the end", () => {
    const r = (min: number, percent: number) => ({ percent, oemUpdatedAt: at(min) });
    const readings = [r(-120, 30), r(-60, 41), r(-10, 42), r(200, 90), r(330, 92), r(400, 91)];
    expect(bracketReadings(readings, at(0), at(300))).toEqual({ before: r(-10, 42), after: r(330, 92) });
    expect(bracketReadings(readings, at(0), at(100))).toBeNull(); // nothing within 90 min after 100
  });
});
