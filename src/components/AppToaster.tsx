"use client";

import { Toaster } from "sonner";

// Toasts per HANDOFF §3b: top of the screen, 4 s, styled with the tokens.
// Success has a lime check, errors a red "!" and a red border; an action
// button (e.g. "Angre") sits on the right.

function SuccessIcon() {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-on-accent" aria-hidden>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 12 5 5 9-10" />
      </svg>
    </span>
  );
}

function ErrorIcon() {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-danger text-sm font-bold text-on-danger" aria-hidden>
      !
    </span>
  );
}

function WarningIcon() {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber text-sm font-bold text-bg" aria-hidden>
      !
    </span>
  );
}

export function AppToaster() {
  return (
    <Toaster
      position="top-center"
      duration={4000}
      icons={{ success: <SuccessIcon />, error: <ErrorIcon />, warning: <WarningIcon /> }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-[min(92vw,380px)] items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3 text-text shadow-lg",
          error: "border-danger",
          warning: "border-amber-border",
          icon: "mt-0.5 shrink-0",
          content: "min-w-0 flex-1",
          title: "text-[15px] font-semibold",
          description: "mt-0.5 text-sm text-muted",
          actionButton:
            "ml-2 shrink-0 self-center rounded-[var(--radius-chip)] border border-accent-tint-border bg-accent-tint px-3 py-1.5 text-sm font-semibold text-accent",
        },
      }}
    />
  );
}
