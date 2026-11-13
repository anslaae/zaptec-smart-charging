// D67: Forvarm while the car is already charging rides along -- the power is
// on, so nothing is cancelled, no command is sent and no row is opened. This
// decides whether that's the case: charging *and* authorised by something the
// tick won't stop (a plan, Smart lading, Lad nå, a guest window, UC14's
// automatic session). Unauthorised charging (about to be stopped by the
// tick) and an existing Forvarm session get the normal Forvarm flow.

export type RunningCharge = "plan" | "smart" | "manual" | "guest" | "automatic";

export function chargeToRideAlong(input: {
  charging: boolean;
  /** Kinds of the open manual_charge_sessions rows on this charger. */
  openKinds: readonly string[];
  /** Sources ("user" | "smart") of this charger's pending/active schedules. */
  scheduleSources: readonly string[];
}): RunningCharge | null {
  if (!input.charging) return null;
  if (input.openKinds.includes("preheat")) return null;
  for (const kind of ["manual", "guest", "automatic"] as const) if (input.openKinds.includes(kind)) return kind;
  if (input.scheduleSources.includes("user")) return "plan";
  if (input.scheduleSources.includes("smart")) return "smart";
  return null;
}
