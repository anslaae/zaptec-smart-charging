"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Keeps Hjem's status honest (D71; replaces AutoRefresh):
//
// - Refreshes every 60 s (3 s in mock mode) while the tab is visible, at once when it becomes
//   visible again or the network is back. Each refresh reads Zaptec's state,
//   so this stays at a minute (Zaptec's fair-use policy).
// - A render older than STALE_MS shown again (app opened, PWA resumed, tab
//   switched, browser back) is marked stale: "Oppdaterer…" and the action
//   buttons are locked until the next render arrives (at most LOCK_MAX_MS,
//   so a failed refresh never traps anyone -- the server re-checks anyway).
// - After a charger command, `settle()` refreshes every SETTLE_POLL_MS for
//   up to SETTLE_MAX_MS until the screen shows the change (Zaptec's /state
//   lags a command by some seconds); buttons stay locked meanwhile.

export const STALE_MS = 10_000;
export const LOCK_MAX_MS = 15_000;
export const SETTLE_POLL_MS = 5_000;
export const SETTLE_MAX_MS = 30_000;
const REFRESH_MS = 60_000;
/** Mock mode has no Zaptec behind it, so Hjem can follow the panel closely. */
export const MOCK_REFRESH_MS = 3_000;

export type SettleTarget = "charging" | "stopped";

// The device's clock may differ from the server's. The smallest gap seen
// between a render's server time and the moment the device first showed it
// is taken as that difference (it includes network time, a second or so);
// a render's age is measured net of it. Module scope, so it survives
// client-side navigation (and a bfcache restore).
let clockSkewMs: number | null = null;
const firstSeen = new Set<string>();

/** Age of a render on this device's clock, net of the measured clock difference. */
export function renderAgeMs(renderedAtIso: string, nowMs: number = Date.now()): number {
  const gap = nowMs - Date.parse(renderedAtIso);
  if (!firstSeen.has(renderedAtIso)) {
    firstSeen.add(renderedAtIso);
    clockSkewMs = clockSkewMs == null ? gap : Math.min(clockSkewMs, gap);
  }
  return gap - (clockSkewMs ?? 0);
}

interface FreshnessValue {
  /** The shown render is older than STALE_MS and a fresh one is on its way. */
  stale: boolean;
  /** Waiting for the charger to show the result of a command. */
  settling: SettleTarget | null;
  /** Action buttons should be disabled. */
  locked: boolean;
  settle: (target: SettleTarget) => void;
  endSettling: () => void;
}

const FreshnessContext = createContext<FreshnessValue>({
  stale: false,
  settling: null,
  locked: false,
  settle: () => {},
  endSettling: () => {},
});

export function useFreshness(): FreshnessValue {
  return useContext(FreshnessContext);
}

/** Whether a charger reading shows what a command asked for. */
export function settledBy(target: SettleTarget, charging: boolean): boolean {
  return target === "charging" ? charging : !charging;
}

export function FreshnessProvider({
  renderedAtIso,
  refreshMs = REFRESH_MS,
  children,
}: {
  /** When the server rendered this page. */
  renderedAtIso: string;
  /** How often to refresh while visible (shorter in mock mode). */
  refreshMs?: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  // The render that was found stale; any newer render clears it by itself.
  const [staleRender, setStaleRender] = useState<string | null>(null);
  const [settling, setSettling] = useState<{ target: SettleTarget; id: number } | null>(null);
  const renderedAt = useRef(renderedAtIso);
  useEffect(() => {
    renderedAt.current = renderedAtIso;
  }, [renderedAtIso]);

  // Checks the shown render's age; old → lock and refresh (returns whether
  // it did). Called from timers and event handlers only, never synchronously
  // in an effect body.
  const checkStale = useCallback((): boolean => {
    const iso = renderedAt.current;
    if (renderAgeMs(iso) <= STALE_MS) return false;
    setStaleRender(iso);
    router.refresh();
    return true;
  }, [router]);

  // When the page is shown (mounted: a load, or a cached copy on client-side
  // navigation). Only then, and on re-show events below -- never for a render
  // a refresh just brought in: a slow server render (Zaptec answering slowly)
  // would otherwise look stale on arrival and refresh itself in a loop.
  useEffect(() => {
    const id = setTimeout(checkStale, 0);
    return () => clearTimeout(id);
  }, [checkStale]);

  // Never lock for longer than LOCK_MAX_MS.
  useEffect(() => {
    if (staleRender == null) return;
    const id = setTimeout(() => setStaleRender(null), LOCK_MAX_MS);
    return () => clearTimeout(id);
  }, [staleRender]);

  // Minute refresh while visible; immediate check on resume / back online.
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (id == null) id = setInterval(() => router.refresh(), refreshMs);
    };
    const stop = () => {
      if (id != null) clearInterval(id);
      id = undefined;
    };
    const resume = () => {
      // A render that isn't stale yet still gets refreshed, without a lock.
      if (!checkStale()) router.refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        resume();
        start();
      } else stop();
    };
    // bfcache restore (iOS PWA / back button) doesn't fire visibilitychange.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) resume();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", onPageShow);
      stop();
    };
  }, [router, checkStale, refreshMs]);

  // After a command: poll until the page shows it, or give up after SETTLE_MAX_MS.
  useEffect(() => {
    if (!settling) return;
    const poll = setInterval(() => router.refresh(), SETTLE_POLL_MS);
    const giveUp = setTimeout(() => setSettling((s) => (s?.id === settling.id ? null : s)), SETTLE_MAX_MS);
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [settling, router]);

  const settle = useCallback((target: SettleTarget) => setSettling({ target, id: Date.now() }), []);
  const endSettling = useCallback(() => setSettling(null), []);
  const stale = staleRender != null && staleRender === renderedAtIso;

  const value = useMemo<FreshnessValue>(
    () => ({
      stale,
      settling: settling?.target ?? null,
      locked: stale || settling != null,
      settle,
      endSettling,
    }),
    [stale, settling, settle, endSettling],
  );

  return <FreshnessContext.Provider value={value}>{children}</FreshnessContext.Provider>;
}
