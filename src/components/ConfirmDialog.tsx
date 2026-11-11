"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// The app's dialog (design/redesign/HANDOFF.md §3b, "Dialoger og
// bekreftelser"): a centred card over the scrim, 20 px radius, 22 px padding,
// a 40 px tinted icon circle, an 18/600 question, a muted body that names
// exactly what changes, and two equal buttons -- safe choice on the left
// (outlined), the action on the right (filled; danger colours when it ends
// or removes something). Esc or a scrim tap = the safe choice.
//
// const confirm = useConfirm();
// const values = await confirm({...});   // null = safe choice
// values carries the duration choice / text field, when the dialog has them.

export type DialogIcon = "warning" | "stop" | "bolt" | "guest" | "logout" | "error";

export interface ConfirmOptions {
  title: string;
  body?: string;
  safeLabel: string;
  actionLabel: string;
  tone?: "danger" | "accent";
  icon?: DialogIcon;
  /** A required single choice (radio list), e.g. how long automatic charging stays on. */
  choice?: { name: string; label: string; options: { value: string; label: string }[]; defaultValue: string };
  /** An optional free-text field, e.g. "Hvem låner?". */
  textField?: { name: string; label: string; hint?: string; placeholder?: string };
}

export type ConfirmValues = Record<string, string>;
type Confirm = (options: ConfirmOptions) => Promise<ConfirmValues | null>;

const ConfirmContext = createContext<Confirm | null>(null);

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm needs <ConfirmProvider> (src/app/layout.tsx)");
  return confirm;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<(ConfirmOptions & { resolve: (values: ConfirmValues | null) => void }) | null>(
    null,
  );
  const confirm = useCallback<Confirm>(
    (options) => new Promise((resolve) => setOpen({ ...options, resolve })),
    [],
  );
  const answer = useCallback(
    (values: ConfirmValues | null) => {
      open?.resolve(values);
      setOpen(null);
    },
    [open],
  );
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {open && <Dialog options={open} onAnswer={answer} />}
    </ConfirmContext.Provider>
  );
}

function Icon({ name }: { name: DialogIcon }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-5 w-5",
    "aria-hidden": true,
  };
  switch (name) {
    case "stop":
      return (
        <svg {...common}>
          <rect x="7" y="7" width="10" height="10" rx="1.5" />
        </svg>
      );
    case "bolt":
      return (
        <svg {...common}>
          <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
        </svg>
      );
    case "guest":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
    case "logout":
      return (
        <svg {...common}>
          <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
        </svg>
      );
    case "error":
      return (
        <svg {...common}>
          <path d="M12 8v5M12 16.5v.5" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case "warning":
      return (
        <svg {...common}>
          <path d="M12 3 2 20h20L12 3Z" />
          <path d="M12 10v4M12 17v.5" />
        </svg>
      );
  }
}

function Dialog({ options, onAnswer }: { options: ConfirmOptions; onAnswer: (values: ConfirmValues | null) => void }) {
  const safeRef = useRef<HTMLButtonElement>(null);
  const [values, setValues] = useState<ConfirmValues>(() =>
    options.choice ? { [options.choice.name]: options.choice.defaultValue } : {},
  );
  const danger = options.tone === "danger";

  useEffect(() => {
    safeRef.current?.focus(); // the safe choice first
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onAnswer(null);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onAnswer]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={options.safeLabel}
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-scrim"
        onClick={() => onAnswer(null)}
      />
      <div
        role={danger ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={options.body ? "confirm-body" : undefined}
        className="relative w-full max-w-sm rounded-[var(--radius-dialog)] border border-border bg-surface p-[22px]"
      >
        {options.icon && (
          <span
            className={`mb-3 flex h-10 w-10 items-center justify-center rounded-full ${
              danger ? "bg-danger-tint text-danger" : "bg-accent-tint text-accent"
            }`}
          >
            <Icon name={options.icon} />
          </span>
        )}
        <h2 id="confirm-title" className="text-[18px] leading-snug font-semibold">
          {options.title}
        </h2>
        {options.body && (
          <p id="confirm-body" className="mt-2 text-[15px] text-muted">
            {options.body}
          </p>
        )}

        {options.choice && (
          <fieldset className="mt-4">
            <legend className="mb-2 text-sm font-semibold">{options.choice.label}</legend>
            <div className="flex flex-col gap-2">
              {options.choice.options.map((option) => {
                const checked = values[options.choice!.name] === option.value;
                return (
                  <label
                    key={option.value}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-chip)] border px-3 text-[15px] ${
                      checked ? "border-accent bg-accent-tint" : "border-border"
                    }`}
                  >
                    <input
                      type="radio"
                      name={options.choice!.name}
                      value={option.value}
                      checked={checked}
                      onChange={() => setValues((v) => ({ ...v, [options.choice!.name]: option.value }))}
                      className="accent-[var(--accent)]"
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {options.textField && (
          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-sm font-semibold">
              {options.textField.label}
              {options.textField.hint && <span className="ml-1 font-normal text-muted">{options.textField.hint}</span>}
            </span>
            <input
              name={options.textField.name}
              maxLength={60}
              placeholder={options.textField.placeholder}
              value={values[options.textField.name] ?? ""}
              onChange={(event) => setValues((v) => ({ ...v, [options.textField!.name]: event.target.value }))}
              className="h-11 rounded-[var(--radius-chip)] border border-border bg-surface px-3 text-[15px] text-text"
            />
          </label>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            ref={safeRef}
            type="button"
            onClick={() => onAnswer(null)}
            className="flex h-12 cursor-pointer items-center justify-center rounded-[var(--radius-button)] border border-border bg-surface px-3 text-[15px] font-semibold text-text"
          >
            {options.safeLabel}
          </button>
          <button
            type="button"
            onClick={() => onAnswer(values)}
            className={`flex h-12 cursor-pointer items-center justify-center rounded-[var(--radius-button)] px-3 text-[15px] font-semibold ${
              danger ? "bg-danger text-on-danger" : "bg-accent text-on-accent"
            }`}
          >
            {options.actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
