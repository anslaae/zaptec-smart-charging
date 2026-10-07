"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { startChargingNow, stopChargingNow, type ActionResult } from "@/lib/zaptec/actions";
import { SubmitButton } from "@/components/SubmitButton";

const initialState: ActionResult = {};

export function ManualChargeButton({
  chargerId,
  chargerName,
  mode,
}: {
  chargerId: string;
  chargerName: string;
  mode: "start" | "stop";
}) {
  const action = mode === "start" ? startChargingNow : stopChargingNow;
  const [state, formAction] = useActionState(action.bind(null, chargerId, chargerName), initialState);

  useEffect(() => {
    if (state.error) {
      toast.error(mode === "start" ? "Couldn't start charging" : "Couldn't stop charging", {
        description: state.error,
      });
    } else if (state.success) {
      toast.success(mode === "start" ? "Charging started" : "Charging stopped");
    }
  }, [state, mode]);

  return (
    <form action={formAction}>
      <SubmitButton
        pendingLabel={mode === "start" ? "Starting…" : "Stopping…"}
        className={
          // A fixed height (not just matching padding/border) so this lines
          // up with the "Plan charging"/"Cancel" buttons it sits beside on
          // every engine -- padding-derived height can still drift a px or
          // two between a <button> and an <a>, or between browsers, when a
          // form control's line-height isn't computed identically to a
          // plain text element's.
          mode === "start"
            ? "flex h-9 shrink-0 items-center justify-center rounded-md border border-transparent bg-foreground px-3 text-sm font-medium text-background"
            : "flex h-9 shrink-0 items-center justify-center rounded-md border border-black/10 px-3 text-sm font-medium dark:border-white/15"
        }
      >
        {mode === "start" ? "Start charging" : "Stop charging"}
      </SubmitButton>
    </form>
  );
}
