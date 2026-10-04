"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Each refresh re-fetches live charger state from the Zaptec API. Zaptec's
// fair-use policy asks integrators to avoid aggressive polling, so this
// stays well under a once-per-minute cadence rather than the 20s it used to
// be — plenty responsive for a household dashboard someone glances at.
export function AutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
