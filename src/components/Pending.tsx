"use client";

import Link, { useLinkStatus } from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { nb } from "@/lib/i18n/nb";
import { ScreenSkeleton, type Screen } from "./Skeletons";

// One loading pattern for every screen (D80):
//
// 1. The tapped control answers at once: a button shows its pending label
//    (ActionButton / SubmitButton), a link shows a small spinner (PendingLink).
// 2. Another screen: its placeholder outline at once -- from its loading.tsx,
//    or, when a tab's screen isn't cached, from ScreenSwap -- or the screen
//    itself when it is cached. The tab bar shows no spinner of its own.
// 3. New data for the same screen (År/Måned, ‹ ›, Historikk's segments): the
//    content stays, dimmed (PendingArea), until the new data replaces it.
// 4. Any wait (2 or 3, or Hjem's background refresh): the thin bar at the top
//    of the screen. It appears only after SHOW_AFTER_MS, so quick ones never flicker.

export const SHOW_AFTER_MS = 150;

interface PendingValue {
  /** A navigation started from a PendingLink is under way. */
  navigating: boolean;
  /** Something is loading (navigation or a background refresh). */
  busy: boolean;
  /** The screen a tab tap is going to, while it loads (ScreenSwap shows its placeholder). */
  screen: Screen | null;
  /** Registers one piece of work; returns a function that ends it. */
  begin: (kind: "nav" | "refresh", screen?: Screen) => () => void;
}

const PendingContext = createContext<PendingValue>({ navigating: false, busy: false, screen: null, begin: () => () => {} });

export function usePending(): PendingValue {
  return useContext(PendingContext);
}

export function PendingProvider({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState({ nav: 0, refresh: 0 });
  const [target, setTarget] = useState<{ screen: Screen; token: object } | null>(null);
  const begin = useCallback((kind: "nav" | "refresh", screen?: Screen) => {
    setCounts((c) => ({ ...c, [kind]: c[kind] + 1 }));
    const token = {};
    if (screen) setTarget({ screen, token });
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      setCounts((c) => ({ ...c, [kind]: Math.max(0, c[kind] - 1) }));
      if (screen) setTarget((t) => (t?.token === token ? null : t));
    };
  }, []);
  const navigating = counts.nav > 0;
  const busy = navigating || counts.refresh > 0;
  const screen = target?.screen ?? null;
  const value = useMemo(() => ({ navigating, busy, screen, begin }), [navigating, busy, screen, begin]);
  return (
    <PendingContext.Provider value={value}>
      <ProgressBar active={busy} />
      {children}
    </PendingContext.Provider>
  );
}

/** True once `active` has lasted `delayMs`; false again as soon as it ends. */
function useDelayed(active: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      const id = setTimeout(() => setShown(false), 0);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(id);
  }, [active, delayMs]);
  return active && shown;
}

function ProgressBar({ active }: { active: boolean }) {
  const shown = useDelayed(active, SHOW_AFTER_MS);
  return (
    <div
      data-testid="progress-bar"
      data-active={shown ? "true" : "false"}
      className={`pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px] overflow-hidden transition-opacity duration-200 ${
        shown ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="progress-bar-runner h-full w-1/3 rounded-full bg-accent" />
      {/* Screen readers hear it once, not the animation. */}
      <span role="status" className="sr-only">
        {shown ? nb.pending.loading : ""}
      </span>
    </div>
  );
}

/** A fixed-size spinner (16 px) that never moves the layout around it. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      data-testid="spinner"
      className={`inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

// Lives inside the Link (useLinkStatus needs that): shows the spinner and
// reports the navigation to the provider while it's pending.
function LinkPendingHint({ overlay, screen }: { overlay: boolean; screen?: Screen }) {
  const { pending } = useLinkStatus();
  const { begin } = usePending();
  const end = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (pending) end.current = begin("nav", screen);
    return () => {
      end.current?.();
      end.current = null;
    };
  }, [pending, begin, screen]);
  // A tab: its screen's placeholder is the answer, not a spinner.
  if (screen) return null;
  if (overlay) {
    // Takes the place of the control's own content (an arrow, a label, a tab
    // icon) while it waits; globals.css hides that content (.pending-link).
    return pending ? (
      <span data-pending="true" className="absolute inset-0 flex items-center justify-center">
        <Spinner />
      </span>
    ) : null;
  }
  return (
    <span data-pending={pending ? "true" : "false"} className={`inline-flex transition-opacity ${pending ? "opacity-100" : "opacity-0"}`}>
      <Spinner />
    </span>
  );
}

type PendingLinkProps = React.ComponentProps<typeof Link> & {
  /** "inline": a spinner after the label (keeps its space); "overlay": over the content. */
  hint?: "inline" | "overlay";
  /** A tab: show this screen's placeholder at once while it loads (ScreenSwap). */
  screen?: Screen;
};

/** A Link whose tap shows at once, and whose wait shows in the top bar (D80). */
export function PendingLink({ hint = "overlay", screen, className = "", children, ...props }: PendingLinkProps) {
  if (screen) {
    return (
      <Link {...props} className={className}>
        {children}
        <LinkPendingHint overlay={false} screen={screen} />
      </Link>
    );
  }
  if (hint === "inline") {
    return (
      <Link {...props} className={className}>
        {children}
        <LinkPendingHint overlay={false} />
      </Link>
    );
  }
  return (
    <Link {...props} className={`pending-link relative ${className}`}>
      <span className="pending-content contents">{children}</span>
      <LinkPendingHint overlay />
    </Link>
  );
}

/** Content that stays while new data for it loads, dimmed (D80 rule 3). */
export function PendingArea({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const { navigating } = usePending();
  const dimmed = useDelayed(navigating, SHOW_AFTER_MS);
  return (
    <div
      data-testid="pending-area"
      aria-busy={navigating}
      className={`flex flex-col gap-4 transition-opacity duration-200 ${dimmed ? "opacity-50" : "opacity-100"} ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * The page area: while a tab's screen loads, its placeholder takes the old
 * screen's place at once (D80 rule 2). The old screen stays mounted (hidden),
 * so nothing is lost if the navigation is replaced by another.
 */
export function ScreenSwap({ children }: { children: React.ReactNode }) {
  const { screen } = usePending();
  return (
    <>
      <div className={screen ? "hidden" : "contents"}>{children}</div>
      {screen && <ScreenSkeleton screen={screen} />}
    </>
  );
}
