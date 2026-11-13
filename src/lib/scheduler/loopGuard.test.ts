import { describe, expect, it } from "vitest";
import { loopGuardStatus, type AutomatedCommand, type CommandDirection } from "./loopGuard";

const now = new Date("2026-11-13T01:45:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);
const seq = (...items: [number, CommandDirection][]): AutomatedCommand[] =>
  items.map(([min, direction]) => ({ at: ago(min), direction }));

describe("loopGuardStatus (D65)", () => {
  it("trips on the 13 Nov flip-flop: start, stop, start, stop, start a minute apart", () => {
    const commands = seq([6, "start"], [5, "stop"], [4, "start"], [3, "stop"], [2, "start"]);
    expect(loopGuardStatus({ commands, lastTripAt: null, lastResetAt: ago(600), now })).toBe("trip");
  });

  it("one change short of the limit is fine", () => {
    const commands = seq([5, "stop"], [4, "start"], [3, "stop"], [2, "start"]);
    expect(loopGuardStatus({ commands, lastTripAt: null, lastResetAt: null, now })).toBe("ok");
  });

  it("stays quiet on a normal plan: stop at plug-in, start, repeated starts, stop at target", () => {
    // pause right after plug-in, start when it's time (twice: the car was slow), complete at target
    const commands = seq([300, "stop"], [200, "start"], [199, "start"], [10, "stop"]);
    expect(loopGuardStatus({ commands, lastTripAt: null, lastResetAt: ago(301), now })).toBe("ok");
    // even squeezed into the window
    const tight = seq([20, "stop"], [15, "start"], [14, "start"], [1, "stop"]);
    expect(loopGuardStatus({ commands: tight, lastTripAt: null, lastResetAt: ago(21), now })).toBe("ok");
  });

  it("changes older than the window don't count", () => {
    const commands = seq([50, "start"], [45, "stop"], [40, "start"], [35, "stop"], [2, "start"]);
    expect(loopGuardStatus({ commands, lastTripAt: null, lastResetAt: null, now })).toBe("ok");
  });

  it("stays paused once tripped, even after the window has emptied", () => {
    expect(loopGuardStatus({ commands: [], lastTripAt: ago(120), lastResetAt: ago(600), now })).toBe("paused");
  });

  it("a re-plug between two ticks with no plan open (new Zaptec session, no plug-in event) clears it", () => {
    const commands = seq([9, "start"], [8, "stop"], [7, "start"], [6, "stop"], [5, "start"]);
    const base = { commands, lastTripAt: ago(5), lastResetAt: ago(600), tripSessionId: "sess-A", now };
    expect(loopGuardStatus({ ...base, currentSessionId: "sess-A" })).toBe("paused");
    // the loop it caught doesn't trip it again right away
    expect(loopGuardStatus({ ...base, currentSessionId: "sess-B" })).toBe("ok");
    // unplugged right now (no session): not cleared by this rule (the unplug event does that)
    expect(loopGuardStatus({ ...base, currentSessionId: null })).toBe("paused");
  });

  it("after clearing, a new loop trips it again", () => {
    const commands = seq([4, "start"], [3.5, "stop"], [3, "start"], [2.5, "stop"], [2, "start"]);
    expect(
      loopGuardStatus({ commands, lastTripAt: ago(20), lastResetAt: null, tripSessionId: "sess-A", currentSessionId: "sess-B", now }),
    ).toBe("trip");
  });

  it("re-plugging (or a person acting in the app) resets it, and older commands no longer count", () => {
    const commands = seq([9, "start"], [8, "stop"], [7, "start"], [6, "stop"], [5, "start"]);
    expect(loopGuardStatus({ commands, lastTripAt: ago(5), lastResetAt: ago(1), now })).toBe("ok");
  });
});
