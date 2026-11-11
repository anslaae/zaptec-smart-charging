"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { BottomSheet, useCloseSheet } from "@/components/BottomSheet";
import { MyOpelLink } from "@/components/MyOpelLink";
import { ActionButton } from "@/components/ActionButton";
import { stopPreheatDialog } from "@/lib/ui/dialogs";
import { SubmitButton } from "@/components/SubmitButton";
import { startPreheat, stopChargingNow, startChargingNow, type ActionResult } from "@/lib/zaptec/actions";
import { formatNumber, formatTime } from "@/lib/datetime";
import { fill, nb } from "@/lib/i18n/nb";

const t = nb.preheatSheet;

export interface PreheatSheetData {
  chargerId: string;
  chargerName: string;
  connected: boolean;
  /** Set once the preheat session is open (after the action and a refresh). */
  preheating: { startedAtIso: string; kw: number | null } | null;
  /** "i morgen 07:30" when a plan is open: starting cancels it (asked here). */
  planReadyBy: string | null;
}

function StepDot({ done, n }: { done: boolean; n: number }) {
  return (
    <span
      aria-hidden
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
        done ? "bg-accent text-on-accent" : "border border-border text-muted"
      }`}
    >
      {done ? "✓" : n}
    </span>
  );
}

// Forvarm (UC8): power from the charger, then climate in myOpel -- the app
// can't start the car's climate itself (no Smartcar climate command for Opel).
export function PreheatSheet({ data }: { data: PreheatSheetData }) {
  const close = useCloseSheet();
  const [startState, startAction] = useActionState<ActionResult, FormData>(
    startPreheat.bind(null, data.chargerId, data.chargerName),
    {},
  );
  useEffect(() => {
    if (startState.error) toast.error(nb.actions.preheatFailed, { description: startState.error });
  }, [startState]);

  const on = data.preheating != null;
  const starting = !on && startState.success;

  return (
    <BottomSheet title={t.title}>
      <p className="text-[15px] text-text-2">{t.intro}</p>

      <ol className="mt-4 flex flex-col gap-3">
        <li className="flex items-start gap-3 rounded-[var(--radius-card)] bg-surface-2 p-4">
          <StepDot done={on} n={1} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">{t.step1}</p>
            {on ? (
              <p className="text-sm text-muted">
                {fill(t.step1Sub, {
                  time: formatTime(data.preheating!.startedAtIso),
                  kw: data.preheating!.kw != null ? formatNumber(data.preheating!.kw, 1) : "–",
                })}
              </p>
            ) : starting ? (
              <p className="text-sm text-muted">{t.starting}</p>
            ) : data.connected ? (
              <form action={startAction} className="mt-2">
                {data.planReadyBy && (
                  <>
                    <input type="hidden" name="cancelPlan" value="1" />
                    <p className="mb-2 text-sm text-amber">{fill(nb.actions.sheetCancelsPlan, { readyBy: data.planReadyBy })}</p>
                  </>
                )}
                <SubmitButton
                  pendingLabel={t.starting}
                  className="flex h-11 items-center justify-center rounded-[var(--radius-chip)] border border-border bg-surface px-4 text-sm font-semibold"
                >
                  {nb.home.connected.preheat}
                </SubmitButton>
              </form>
            ) : (
              <p className="text-sm text-muted">{nb.home.noCar.status}</p>
            )}
          </div>
        </li>
        <li className="flex items-start gap-3 rounded-[var(--radius-card)] bg-surface-2 p-4">
          <StepDot done={false} n={2} />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">{t.step2}</p>
            <p className="text-sm text-muted">{t.step2Sub}</p>
          </div>
        </li>
      </ol>

      <MyOpelLink
        label={`${t.openMyOpel} ↗`}
        className="mt-5 flex h-[52px] w-full items-center justify-center rounded-[var(--radius-button)] bg-accent px-4 text-base font-semibold text-on-accent"
      />
      {on && (
        <ActionButton
          action={() => stopChargingNow(data.chargerId, data.chargerName, {}, new FormData())}
          label={t.stop}
          className="mt-1 flex h-11 w-full items-center justify-center text-[15px] font-semibold text-danger"
          confirm={stopPreheatDialog()}
          success={nb.toasts.chargingStopped.title}
          errorMessage={nb.actions.chargeStopFailed}
          onSuccess={close}
        />
      )}
    </BottomSheet>
  );
}

export interface ChargeNowSheetData {
  chargerId: string;
  chargerName: string;
  planReadyBy: string | null;
}

// The "Lad nå" push action lands here (?action=charge-now). Opening a link
// never starts charging by itself -- one more tap confirms.
export function ChargeNowSheet({ data }: { data: ChargeNowSheetData }) {
  const close = useCloseSheet();
  const [state, formAction] = useActionState<ActionResult, FormData>(
    startChargingNow.bind(null, data.chargerId, data.chargerName),
    {},
  );
  useEffect(() => {
    if (state.error) toast.error(nb.actions.chargeStartFailed, { description: state.error });
    else if (state.success) {
      toast.success(nb.actions.chargeStarted);
      close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <BottomSheet title={nb.chargeNowSheet.title}>
      <p className="text-[15px] text-text-2">{nb.chargeNowSheet.body}</p>
      {data.planReadyBy && (
        <p className="mt-2 text-[15px] font-semibold text-amber">
          {fill(nb.actions.sheetCancelsPlan, { readyBy: data.planReadyBy })}
        </p>
      )}
      <form action={formAction} className="mt-5">
        {data.planReadyBy && <input type="hidden" name="cancelPlan" value="1" />}
        <SubmitButton
          pendingLabel={nb.actions.working}
          className="flex h-[52px] w-full items-center justify-center rounded-[var(--radius-button)] bg-accent px-4 text-base font-semibold text-on-accent"
        >
          {nb.chargeNowSheet.confirm}
        </SubmitButton>
      </form>
      <button
        type="button"
        onClick={close}
        className="mt-1 flex h-11 w-full items-center justify-center text-[15px] font-semibold text-muted"
      >
        {nb.chargeNowSheet.cancel}
      </button>
    </BottomSheet>
  );
}
