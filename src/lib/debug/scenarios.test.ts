import { describe, expect, it } from "vitest";
import { HOME_STATES, homeState } from "@/lib/ui/homeState";
import { DEBUG_SCENARIOS } from "./scenarios";

describe("debug scenarios", () => {
  it.each(Object.entries(DEBUG_SCENARIOS))("%s produces the home state it claims", (_key, scenario) => {
    expect(
      homeState({
        state: scenario.state,
        schedule: scenario.schedule,
        openSession: scenario.openSession,
        lastCompletedPlanSessionId: scenario.lastCompletedPlanSessionId,
      }),
    ).toBe(scenario.homeState);
  });

  it("covers every home state", () => {
    const covered = new Set(Object.values(DEBUG_SCENARIOS).map((s) => s.homeState));
    expect([...covered].sort()).toEqual([...HOME_STATES].sort());
  });
});
