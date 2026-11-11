"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { nb } from "@/lib/i18n/nb";

/** Closes whichever sheet is open by dropping the ?sheet / ?action param. */
export function useCloseSheet() {
  const router = useRouter();
  return () => router.replace("/", { scroll: false });
}

// Bottom sheet over Hjem (design/redesign/HANDOFF.md: "Sheets, not pages").
// Opened by a URL param (?sheet=plan, ?sheet=preheat, ?action=charge-now) so
// push notifications can deep-link; closing replaces the URL with "/".
export function BottomSheet({
  title,
  children,
  labelledBy = "sheet-title",
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  labelledBy?: string;
  /** Close without touching the URL (sheets opened from local state, e.g. in Innstillinger). */
  onClose?: () => void;
}) {
  const closeRoute = useCloseSheet();
  const close = onClose ?? closeRoute;
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
    // close is stable enough for this purpose (router.replace)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label={nb.planSheet.close}
        className="absolute inset-0 cursor-default bg-scrim"
        onClick={close}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-y-auto rounded-t-[var(--radius-sheet)] bg-surface px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] outline-none"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 shrink-0 rounded-full bg-subtle" aria-hidden />
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={labelledBy} className="text-xl font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={close}
            className="flex min-h-11 items-center px-1 text-[15px] font-semibold text-accent"
          >
            {nb.planSheet.close}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
