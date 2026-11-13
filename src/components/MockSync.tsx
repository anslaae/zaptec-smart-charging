"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

// Mock mode only (rendered by MockBanner). The /dev/mock panel is usually open
// in its own tab next to Hjem; a tab that stays visible (side-by-side
// windows) would otherwise show a panel change only at its next minute
// refresh. The panel announces every change on this channel and the other
// tabs refresh at once.

const CHANNEL = "zaptec-mock";

/** Called by the panel after each action. */
export function announceMockChange(): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage("changed");
  channel.close();
}

export function MockSync() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    // The panel refreshes itself after its own actions.
    if (typeof BroadcastChannel === "undefined" || pathname === "/dev/mock") return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => router.refresh();
    return () => channel.close();
  }, [router, pathname]);
  return null;
}
