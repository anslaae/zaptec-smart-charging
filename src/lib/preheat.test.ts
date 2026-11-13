import { describe, expect, it } from "vitest";
import { chargeToRideAlong } from "./preheat";

describe("chargeToRideAlong (D67)", () => {
  const base = { charging: true, openKinds: [] as string[], scheduleSources: [] as string[] };

  it("names what keeps the car charging", () => {
    expect(chargeToRideAlong({ ...base, openKinds: ["manual"] })).toBe("manual");
    expect(chargeToRideAlong({ ...base, openKinds: ["guest"] })).toBe("guest");
    expect(chargeToRideAlong({ ...base, openKinds: ["automatic"] })).toBe("automatic");
    expect(chargeToRideAlong({ ...base, scheduleSources: ["user"] })).toBe("plan");
    expect(chargeToRideAlong({ ...base, scheduleSources: ["smart"] })).toBe("smart");
  });

  it("is null when not charging, already preheating, or nothing authorises it", () => {
    expect(chargeToRideAlong({ ...base, charging: false, openKinds: ["manual"] })).toBeNull();
    expect(chargeToRideAlong({ ...base, openKinds: ["preheat"] })).toBeNull();
    expect(chargeToRideAlong(base)).toBeNull();
  });
});
