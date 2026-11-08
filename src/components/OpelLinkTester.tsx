"use client";

import { useEffect, useRef, useState } from "react";
import {
  MYOPEL_APP_STORE_URL,
  MYOPEL_PLAY_STORE_URL,
  MYOPEL_SCHEME_URL,
  myOpelAndroidLauncherIntent,
  myOpelAndroidSchemeIntent,
} from "@/lib/myopel";

type Platform = "android" | "ios" | "both";

interface Candidate {
  id: string;
  label: string;
  description: string;
  href: string;
  platform: Platform;
}

const CANDIDATES: Candidate[] = [
  {
    id: "launcher-intent",
    label: "A. Intent: launch by package",
    description: "Starts myOpel's main screen by its Android package name. No fallback, so if it isn't installed nothing happens.",
    href: myOpelAndroidLauncherIntent(),
    platform: "android",
  },
  {
    id: "scheme-intent",
    label: "B. Intent: mymopsdk scheme",
    description: "Opens myOpel through its own URL scheme, limited to the myOpel package. No fallback.",
    href: myOpelAndroidSchemeIntent(),
    platform: "android",
  },
  {
    id: "launcher-intent-fallback",
    label: "C. Intent A + Play Store fallback",
    description: "Same as A, but goes to the Play Store if myOpel isn't installed. This is the likely final version for Android.",
    href: myOpelAndroidLauncherIntent(MYOPEL_PLAY_STORE_URL),
    platform: "android",
  },
  {
    id: "scheme-url",
    label: "D. Plain mymopsdk:// link",
    description: "Bare custom-scheme link. The only option that can also work on iPhone.",
    href: MYOPEL_SCHEME_URL,
    platform: "both",
  },
  {
    id: "play-store",
    label: "E. Play Store link (current button)",
    description: "What the dashboard does today on Android. Baseline for comparison.",
    href: MYOPEL_PLAY_STORE_URL,
    platform: "android",
  },
  {
    id: "app-store",
    label: "F. App Store link (current iPhone button)",
    description: "What the dashboard does today on iPhone. Baseline for comparison.",
    href: MYOPEL_APP_STORE_URL,
    platform: "ios",
  },
];

type Outcome = "left" | "stayed";

// How long after a tap to decide whether the browser handed off to another
// app. If the page got hidden in that window, something else came to the
// front (myOpel, or a store app for E/F); if not, the link did nothing.
const DETECT_WINDOW_MS = 2500;

export function OpelLinkTester() {
  const [results, setResults] = useState<Record<string, Outcome>>({});
  const [env, setEnv] = useState<{ ua: string; standalone: boolean } | null>(null);
  const pending = useRef<{ id: string; hidden: boolean; timer: number } | null>(null);

  useEffect(() => {
    // navigator/matchMedia only exist in the browser, so this is read after
    // mount rather than during render (keeps server and client HTML equal).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnv({
      ua: navigator.userAgent,
      standalone: window.matchMedia("(display-mode: standalone)").matches,
    });

    function markHidden() {
      if (pending.current && document.visibilityState === "hidden") pending.current.hidden = true;
    }
    document.addEventListener("visibilitychange", markHidden);
    window.addEventListener("pagehide", markHidden);
    return () => {
      document.removeEventListener("visibilitychange", markHidden);
      window.removeEventListener("pagehide", markHidden);
      if (pending.current) window.clearTimeout(pending.current.timer);
    };
  }, []);

  function track(id: string) {
    if (pending.current) window.clearTimeout(pending.current.timer);
    const entry = { id, hidden: false, timer: 0 };
    entry.timer = window.setTimeout(() => {
      setResults((prev) => ({ ...prev, [id]: entry.hidden ? "left" : "stayed" }));
      pending.current = null;
    }, DETECT_WINDOW_MS);
    pending.current = entry;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-black/60 dark:text-white/60">
        Tap each button, then come back to this page. A result appears under each one: whether the browser
        switched to another app, or nothing happened. Write down which app actually opened (myOpel or a store).
      </p>

      {env && (
        <div className="rounded-md border border-black/10 p-3 font-mono text-xs break-all text-black/60 dark:border-white/15 dark:text-white/60">
          <div>{env.standalone ? "Installed app (PWA)" : "Browser tab"}</div>
          <div className="mt-1">{env.ua}</div>
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {CANDIDATES.map((c) => {
          const outcome = results[c.id];
          return (
            <li key={c.id} className="rounded-lg border border-black/10 p-3 dark:border-white/15">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium">{c.label}</div>
                <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-[10px] uppercase text-black/60 dark:bg-white/10 dark:text-white/60">
                  {c.platform === "both" ? "Android + iPhone" : c.platform === "ios" ? "iPhone" : "Android"}
                </span>
              </div>
              <p className="mt-1 text-xs text-black/60 dark:text-white/60">{c.description}</p>
              <a
                href={c.href}
                onClick={() => track(c.id)}
                className="mt-2 flex h-9 items-center justify-center rounded-md border border-black/10 px-3 text-sm font-medium hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
              >
                Open
              </a>
              {outcome && (
                <p
                  className={`mt-2 text-xs ${outcome === "left" ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}`}
                >
                  {outcome === "left"
                    ? "Switched to another app. Which one opened?"
                    : "Stayed in the browser. Nothing opened."}
                </p>
              )}
              <p className="mt-2 font-mono text-[10px] break-all text-black/40 dark:text-white/40">{c.href}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
