"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { startChargingNow, stopChargingNow, type ActionResult } from "@/lib/zaptec/actions";
import { SubmitButton } from "@/components/SubmitButton";

const initialState: ActionResult = {};

export function ManualChargeButton({
  chargerId,
  mode,
}: {
  chargerId: string;
  mode: "start" | "stop";
}) {
  const action = mode === "start" ? startChargingNow : stopChargingNow;
  const [state, formAction] = useActionState(action.bind(null, chargerId), initialState);

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
    <form action={formAction} className="mt-3">
      <SubmitButton
        pendingLabel={mode === "start" ? "Starting…" : "Stopping…"}
        className={
          mode === "start"
            ? "w-full rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background"
            : "w-full rounded-md border border-black/10 px-3 py-2 text-sm font-medium dark:border-white/15"
        }
      >
        {mode === "start" ? "Start charging" : "Stop charging"}
      </SubmitButton>
    </form>
  );
}
