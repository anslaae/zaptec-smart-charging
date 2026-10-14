import "server-only";
import { env } from "@/lib/env";
import { getSmartcarAccessToken } from "./auth";
import { SMARTCAR_API_BASE, STATE_OF_CHARGE_SIGNAL } from "./constants";
import { parseStateOfCharge } from "./state";
import type { SmartcarSignalApiResponse, StateOfCharge } from "./types";

// Smartcar isn't core to the app (the Zaptec charger integration is) and
// isn't necessarily configured -- mirrors push/send.ts's no-op-if-unconfigured
// pattern. Any failure here (missing env vars, a thrown error, a non-OK
// response, an ERROR signal status) returns null rather than throwing, so it
// can never break the dashboard's Promise.all in page.tsx.
export async function getStateOfCharge(): Promise<StateOfCharge | null> {
  if (
    !env.SMARTCAR_CLIENT_ID ||
    !env.SMARTCAR_CLIENT_SECRET ||
    !env.SMARTCAR_VEHICLE_ID ||
    !env.SMARTCAR_USER_ID
  ) {
    return null;
  }

  try {
    const token = await getSmartcarAccessToken();
    const response = await fetch(
      `${SMARTCAR_API_BASE}/vehicles/${env.SMARTCAR_VEHICLE_ID}/signals/${STATE_OF_CHARGE_SIGNAL}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "sc-user-id": env.SMARTCAR_USER_ID,
        },
        // The car's own battery data updates slowly (observed OEM update gaps
        // of several hours on this Opel Mokka) and Smartcar's fair-use
        // guidance favors avoiding aggressive polling -- a 30-minute cache is
        // generous relative to how often the reading can even change.
        next: { revalidate: 1800 },
      },
    );
    if (!response.ok) return null;

    const data = (await response.json()) as SmartcarSignalApiResponse;
    return parseStateOfCharge(data);
  } catch {
    return null;
  }
}
