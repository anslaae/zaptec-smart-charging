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
          // Both variants carry a 1px border (transparent for "start") so
          // they're the same height as the bordered "stop"/"Cancel" buttons
          // they sit beside -- a border changes a button's rendered height
          // even with box-sizing: border-box, since there's no fixed height.
          mode === "start"
            ? "shrink-0 rounded-md border border-transparent bg-foreground px-3 py-1.5 text-sm font-medium text-background"
            : "shrink-0 rounded-md border border-black/10 px-3 py-1.5 text-sm font-medium dark:border-white/15"
        }
      >
        {mode === "start" ? "Start charging" : "Stop charging"}
      </SubmitButton>
    </form>
  );
}
