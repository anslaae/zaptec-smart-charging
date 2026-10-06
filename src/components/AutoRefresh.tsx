"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Each refresh re-fetches live charger state from the Zaptec API. Zaptec's
// fair-use policy asks integrators to avoid aggressive polling, so this
// stays well under a once-per-minute cadence rather than the 20s it used to
// be — plenty responsive for a household dashboard someone glances at.
//
// Only polls while the tab is actually visible -- no point refreshing a
// backgrounded tab, and it avoids firing a request into a network that
// hasn't reconnected yet right after the machine wakes from sleep (that gap
// is also what usually causes the browser's own "this page couldn't load"
// error on an inactive tab -- unrelated to this component, but polling into
// it doesn't help). Refreshes immediately when the tab becomes visible
// again, or when the browser reports the network is back, rather than
// waiting up to a minute for fresh data.
export function AutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      if (id != null) return;
      id = setInterval(() => router.refresh(), intervalMs);
    };
    const stop = () => {
      if (id == null) return;
      clearInterval(id);
      id = undefined;
    };
    const refreshNow = () => router.refresh();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshNow();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", refreshNow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", refreshNow);
      stop();
    };
  }, [router, intervalMs]);

  return null;
}
