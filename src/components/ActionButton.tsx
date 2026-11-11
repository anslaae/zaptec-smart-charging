"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { fill, nb } from "@/lib/i18n/nb";
import { useConfirm, type ConfirmOptions, type ConfirmValues } from "@/components/ConfirmDialog";

export interface ActionOutcome {
  error?: string;
  success?: boolean;
  /** The Zaptec command itself failed (nothing else was changed): offer "Prøv igjen". */
  commandFailed?: boolean;
}

export type ToastText = string | { title: string; body?: string };

const UNDO_MS = 10_000;

/**
 * A button that runs a server action and reports the outcome (HANDOFF §3b):
 * - `confirm`: ask first in the app's dialog; its values (duration choice,
 *   name) are passed to the action.
 * - A failed charger command opens the "Fikk ikke kontakt med laderen"
 *   dialog with "Prøv igjen"; other errors are error toasts.
 * - `undo`: an "Angre" action on the success toast for 10 s.
 * The result is handled right after the awaited call, not in an effect: most
 * of these actions change the very state that rendered the button, so the
 * refresh can unmount it before an effect would run.
 */
export function ActionButton({
  action,
  label,
  className,
  success,
  errorMessage,
  confirm: confirmOptions,
  pendingLabel = nb.actions.working,
  onSuccess,
  undo,
}: {
  action: (values: ConfirmValues) => Promise<ActionOutcome>;
  label: string;
  className: string;
  success: ToastText;
  errorMessage: string;
  confirm?: ConfirmOptions;
  pendingLabel?: string;
  onSuccess?: () => void;
  undo?: { action: () => Promise<ActionOutcome>; success: ToastText };
}) {
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  const run = (values: ConfirmValues) =>
    startTransition(async () => {
      const result = await action(values).catch(
        (error: unknown): ActionOutcome => ({ error: error instanceof Error ? error.message : String(error) }),
      );
      if (result.commandFailed) {
        const retry = await confirm({
          title: nb.dialogs.chargerError.title,
          body: fill(nb.dialogs.chargerError.body, { command: label }),
          safeLabel: nb.dialogs.chargerError.safe,
          actionLabel: nb.dialogs.chargerError.action,
          icon: "error",
          tone: "danger",
        });
        if (retry) run(values);
        return;
      }
      if (result.error) {
        toast.error(errorMessage, { description: result.error });
        return;
      }
      const text = typeof success === "string" ? { title: success } : success;
      toast.success(text.title, {
        description: text.body,
        ...(undo && {
          duration: UNDO_MS,
          action: {
            label: nb.toasts.planCancelled.undo,
            onClick: async () => {
              const restored = await undo.action();
              if (restored.error) toast.error(errorMessage, { description: restored.error });
              else {
                const u = typeof undo.success === "string" ? { title: undo.success } : undo.success;
                toast.success(u.title, { description: u.body });
              }
            },
          },
        }),
      });
      onSuccess?.();
    });

  return (
    <button
      type="button"
      disabled={pending}
      className={`${className} cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
      onClick={async () => {
        const values = confirmOptions ? await confirm(confirmOptions) : {};
        if (values) run(values);
      }}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
