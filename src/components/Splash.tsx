"use client";

import { useEffect, useRef, useState } from "react";
import { nb } from "@/lib/i18n/nb";

// Start-up animation (HANDOFF §6f): on a cold start of the installed app, the
// ring fills red → amber → lime and the bolt pops in (1.8 s, pure CSS in
// globals.css), then it cross-fades to the first screen once that is ready.
//
// - SPLASH_SCRIPT runs before the first paint and decides: installed app (or
//   `?splash` to try it in a browser), and not yet shown in this app start
//   (sessionStorage) → <html data-splash="on">; otherwise the markup stays
//   display:none, so a warm start or a reload never sees it.
// - Never cut off half-way: it leaves only after the name's animation ended
//   (straight away with reduced motion) AND a real screen is shown (a <main>
//   that isn't a placeholder). After 8 s it says "Henter status…".

export const SPLASH_SLOW_MS = 8_000;
const FADE_MS = 200;

export const SPLASH_SCRIPT = `(function(){try{var d=document.documentElement;var force=/[?&]splash(=|&|$)/.test(location.search);var app=window.matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;if(force||(app&&!sessionStorage.getItem("splash-shown"))){sessionStorage.setItem("splash-shown","1");d.setAttribute("data-splash","on");}}catch(e){}})();`;

// The icon's ring and bolt (src/app/icon.svg) in a 1024 box: r = 300, so the
// arc's circumference is 1885.
const BOLT = "M35.5 16 24 33h7.5l-3 15 12.5-18H33z";

function screenReady(): boolean {
  return Array.from(document.querySelectorAll("main")).some((m) => m.getAttribute("aria-busy") !== "true");
}

export function Splash() {
  const [phase, setPhase] = useState<"off" | "playing" | "leaving">("off");
  const [slow, setSlow] = useState(false);
  const nameRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const html = document.documentElement;
    if (html.getAttribute("data-splash") !== "on") return;
    const start = setTimeout(() => setPhase("playing"), 0);

    let animationDone = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let ready = screenReady();
    let leaving = false;
    let removeTimer: ReturnType<typeof setTimeout> | undefined;
    const slowTimer = setTimeout(() => setSlow(true), SPLASH_SLOW_MS);
    const tryLeave = () => {
      if (leaving || !animationDone || !ready) return;
      leaving = true;
      clearTimeout(slowTimer);
      setPhase("leaving");
      removeTimer = setTimeout(() => {
        html.removeAttribute("data-splash");
        setPhase("off");
      }, FADE_MS);
    };

    const name = nameRef.current;
    const onEnd = (event: AnimationEvent) => {
      if (event.target !== name) return;
      animationDone = true;
      tryLeave();
    };
    name?.addEventListener("animationend", onEnd);
    // The CSS may already have finished before hydration (a slow device).
    if (name && name.getAnimations().every((a) => a.playState === "finished")) animationDone = true;

    const observer = new MutationObserver(() => {
      if (!ready && screenReady()) {
        ready = true;
        tryLeave();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-busy"] });
    tryLeave();

    return () => {
      clearTimeout(start);
      clearTimeout(slowTimer);
      if (removeTimer) clearTimeout(removeTimer);
      observer.disconnect();
      name?.removeEventListener("animationend", onEnd);
    };
  }, []);

  return (
    <div
      role="status"
      aria-label={nb.app.splashLabel}
      data-testid="splash"
      data-phase={phase}
      className="splash fixed inset-0 z-[100] flex-col items-center justify-center bg-[#0E0F0D]"
    >
      <svg viewBox="0 0 1024 1024" width="168" height="168" aria-hidden className="overflow-visible">
        <circle className="splash-glow" cx="512" cy="512" r="300" fill="none" stroke="#8FCB3A" strokeWidth="140" />
        <circle className="splash-track" cx="512" cy="512" r="300" fill="none" stroke="#2A3122" strokeWidth="100" />
        <circle
          className="splash-arc"
          cx="512"
          cy="512"
          r="300"
          fill="none"
          strokeWidth="100"
          strokeLinecap="round"
          strokeDasharray="1885"
          transform="rotate(-90 512 512)"
        />
        <g className="splash-bolt">
          <path d={BOLT} fill="#F1F3EE" transform="translate(512 512) scale(14.29) translate(-32 -32)" />
        </g>
      </svg>
      <p ref={nameRef} className="splash-name mt-7 text-[30px] font-bold text-[#F1F3EE]">
        {nb.app.name}
      </p>
      <p className={`mt-2 h-5 text-[13px] text-[#A2A89C] transition-opacity ${slow ? "opacity-100" : "opacity-0"}`}>
        {slow ? nb.app.splashSlow : ""}
      </p>
    </div>
  );
}
