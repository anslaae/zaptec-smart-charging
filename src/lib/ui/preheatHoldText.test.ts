import { describe, expect, it } from "vitest";
import { preheatHoldText } from "./preheatHoldText";

describe("preheatHoldText (D67)", () => {
  const untilIso = "2026-11-13T06:30:00Z"; // 07:30 Oslo
  it("says until when, past which target, and what it may add", () => {
    expect(preheatHoldText({ untilIso, targetPercent: 80, estimate: { kwh: 3, nok: 4 } })).toBe(
      "Strømmen holdes på til 07:30. Bilen kan lade forbi 80 % i mellomtiden – ca. 3,0 kWh / 4 kr ekstra ved dagens pris.",
    );
  });
  it("only kWh without a price; no target % for a plan without one", () => {
    expect(preheatHoldText({ untilIso, targetPercent: null, estimate: { kwh: 2.5, nok: null } })).toBe(
      "Strømmen holdes på til 07:30. Bilen kan lade mer enn planen i mellomtiden – ca. 2,5 kWh ekstra.",
    );
  });
});
