"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { startPreheat, type ActionResult } from "@/lib/zaptec/actions";
import { SubmitButton } from "@/components/SubmitButton";

const initialState: ActionResult = {};

export function PreheatButton({
  chargerId,
  chargerName,
  onStarted,
}: {
  chargerId: string;
  chargerName: string;
  // Reports success up to ChargerCard rather than switching this component's
  // own render -- once charging actually starts, ChargerCard swaps this
  // button out for "Stop charging" (same as any other manual session), which
  // would otherwise unmount this component and lose the "open myOpel" link
  // before the user gets to tap it.
  onStarted: () => void;
}) {
  const [state, formAction] = useActionState(startPreheat.bind(null, chargerId, chargerName), initialState);

  useEffect(() => {
    if (state.error) {
      toast.error("Couldn't start preheating", { description: state.error });
    } else if (state.success) {
      toast.success("Charging started -- open myOpel to start climate control");
      onStarted();
    }
    // onStarted is a new closure every parent render, so it's deliberately
    // left out of the deps below -- only re-run this when state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (
          !confirm(
            "Start charging so the car can draw preheat power from the charger instead of its own battery? You'll still need to turn on climate control yourself in the myOpel app.",
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <SubmitButton
        pendingLabel="Starting…"
        className="flex h-9 shrink-0 items-center justify-center rounded-md border border-black/10 px-3 text-sm font-medium hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
      >
        Preheat
      </SubmitButton>
    </form>
  );
}
