import { describe, expect, it } from "vitest";
import { decideSmart, keepCurrentBlock, REPLAN_HOLD_MS, type SmartBlock } from "./smart";

// H2: a Smart re-plan must never switch the charger off in the block in
// progress, and a kW re-plan must not switch it on within 30 min -- so a
// re-plan every 10 min can't make pause/resume flip-flop (D64/D65).

const t0 = new Date("2026-11-20T23:00:00Z");
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const block = (from: number, to: number): SmartBlock => ({ start: at(from).toISOString(), end: at(to).toISOString() });
const inBlock = (blocks: SmartBlock[], now: Date) =>
  decideSmart({ blocks, now, deliveredKwh: 0, targetKwh: 100 }) === "charge";

describe("keepCurrentBlock", () => {
  it("keeps the block in progress and only fills the time after it", () => {
    const kept = keepCurrentBlock([block(0, 60), block(120, 180)], [block(30, 50), block(70, 100)], at(10), true);
    expect(kept).toEqual([block(0, 60), block(70, 100)]);
  });

  it("trims new blocks that overlap the block in progress", () => {
    expect(keepCurrentBlock([block(0, 60)], [block(40, 90)], at(10), true)).toEqual([block(0, 60), block(60, 90)]);
  });

  it("outside a block, a kW re-plan starts nothing for 30 min; a SoC re-plan may start now", () => {
    expect(keepCurrentBlock([block(60, 120)], [block(10, 40), block(35, 90)], at(10), true)).toEqual([block(40, 90)]);
    expect(keepCurrentBlock([block(60, 120)], [block(10, 40)], at(10), false)).toEqual([block(10, 40)]);
    expect(REPLAN_HOLD_MS).toBe(30 * 60_000);
  });
});

describe("no flip-flop across repeated re-plans", () => {
  it("a re-plan every 10 min with jumping kW never turns charging off mid-block or on within 30 min", () => {
    let blocks = [block(0, 90)];
    const changes: { minute: number; on: boolean }[] = [];
    let on = inBlock(blocks, at(0));
    for (let minute = 1; minute <= 300; minute++) {
      const now = at(minute);
      if (minute % 10 === 0) {
        // A planner whose answer jumps with the measured kW: short blocks that
        // start/end around now, alternating -- the worst case for flapping.
        const fresh = minute % 20 === 0 ? [block(minute + 5, minute + 25)] : [block(minute - 5, minute + 3), block(minute + 40, minute + 60)];
        const before = inBlock(blocks, now);
        blocks = keepCurrentBlock(blocks, fresh, now, true);
        expect(inBlock(blocks, now)).toBe(before); // the re-plan itself never flips "now"
      }
      const next = inBlock(blocks, now);
      if (next !== on) changes.push({ minute, on: next });
      on = next;
    }
    // Every on->off and off->on is at least 30 min after the previous change, except a block's planned end.
    for (let i = 1; i < changes.length; i++) {
      if (changes[i].on) expect(changes[i].minute - changes[i - 1].minute).toBeGreaterThanOrEqual(30);
    }
  });
});

describe("keepCurrentBlock while charging past the last block", () => {
  it("keeps the old blocks, so a kW re-plan never pauses a late car", () => {
    const old = [block(0, 60)];
    const now = at(90); // last block ended, still short of the target, car charging
    expect(inBlock(old, now)).toBe(true); // afterLast -> charge
    const kept = keepCurrentBlock(old, [block(100, 160)], now, true, true);
    expect(kept).toEqual(old);
    expect(inBlock(kept, now)).toBe(true);
  });

  it("not charging: the 30 min hold-off still applies", () => {
    const kept = keepCurrentBlock([block(0, 60)], [block(95, 160)], at(90), true, false);
    expect(Date.parse(kept[0].start)).toBe(at(90).getTime() + REPLAN_HOLD_MS);
  });
});
