"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/Switch";
import { ActionButton } from "@/components/ActionButton";
import { lendDialog } from "@/lib/ui/dialogs";
import { SubmitButton } from "@/components/SubmitButton";
import {
  sendTestNotification,
  setEnergyPrice,
  setGridTariff,
  type SettingsResult,
} from "@/lib/settingsActions";
import { endLending, lendCharger } from "@/lib/zaptec/actions";
import { formatNumber } from "@/lib/datetime";
import { fill, nb } from "@/lib/i18n/nb";

const s = nb.settings;
const smallButton =
  "flex h-11 shrink-0 items-center justify-center rounded-[var(--radius-chip)] border border-border bg-surface px-4 text-sm font-semibold";
const input =
  "h-11 min-w-0 flex-1 rounded-[var(--radius-chip)] border border-border bg-surface px-3 text-[15px] text-text";

function useResultToast(state: SettingsResult, success: string, failure: string) {
  useEffect(() => {
    if (state.error) toast.error(failure, { description: state.error });
    else if (state.success) toast.success(success);
  }, [state, success, failure]);
}

function SwitchRow({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[15px] font-semibold">{title}</p>
        {sub && <p className="text-xs text-muted">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

/** UC15 "Lån ut laderen": asks first (with an optional "Hvem låner?"), or ends the window. */
export function LendChargerRow({
  chargerId,
  chargerName,
  active,
  guestName,
  carName,
  planReadyBy,
}: {
  chargerId: string;
  chargerName: string;
  active: boolean;
  guestName: string | null;
  carName: string;
  /** Set when a plan is open: lending cancels it (D29). */
  planReadyBy: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[15px] font-semibold">{s.charging.lend}</p>
        <p className={`text-xs ${active ? "text-accent" : "text-muted"}`}>
          {active
            ? guestName
              ? fill(s.charging.lendActiveNamed, { name: guestName })
              : s.charging.lendActive
            : s.charging.lendSub}
        </p>
      </div>
      {active ? (
        <ActionButton
          action={() => endLending(chargerId, chargerName, {}, new FormData())}
          label={s.charging.lendEnd}
          className={smallButton}
          success={nb.home.guest.ended}
          errorMessage={nb.home.guest.endFailed}
        />
      ) : (
        <ActionButton
          action={(values) => {
            const fd = new FormData();
            if (planReadyBy) fd.set("cancelPlan", "1");
            if (values.guestName) fd.set("guestName", values.guestName);
            return lendCharger(chargerId, chargerName, {}, fd);
          }}
          label={s.charging.lendAction}
          className={smallButton}
          success={{ title: nb.toasts.guestOn.title, body: nb.toasts.guestOn.body }}
          errorMessage={s.charging.saveFailed}
          confirm={lendDialog(carName, planReadyBy)}
        />
      )}
    </div>
  );
}

/** Strømpris: Norgespris kr/kWh incl. VAT, used for every cost figure. */
export function PriceRow({ price }: { price: number }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState<SettingsResult, FormData>(setEnergyPrice, {});
  useResultToast(state, s.price.saved, s.charging.saveFailed);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- close the editor once the save went through
    if (state.success) setEditing(false);
  }, [state]);
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px]">{s.price.model}</span>
        <span className="text-sm text-muted">{s.price.norgespris}</span>
      </div>
      {editing ? (
        <form action={formAction} className="flex flex-col gap-1">
          <label htmlFor="energy-price" className="text-[15px]">
            {s.price.perKwh}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="energy-price"
              name="price"
              inputMode="decimal"
              defaultValue={formatNumber(price, 2)}
              className={input}
              autoFocus
            />
            <SubmitButton pendingLabel={nb.actions.working} className={smallButton}>
              {s.price.save}
            </SubmitButton>
          </div>
          <p className="text-xs text-muted">{s.price.perKwhSub}</p>
        </form>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="flex min-h-11 items-center justify-between gap-3 text-left">
          <span className="text-[15px]">{s.price.perKwh}</span>
          <span className="text-sm text-muted">
            {fill(s.price.perKwhValue, { price: formatNumber(price, 2) })} ›
          </span>
        </button>
      )}
    </>
  );
}

/** Nettleie energiledd, day and night/weekend (D30). Empty = costs without nettleie. */
export function GridTariffRows({ day, night }: { day: number | null; night: number | null }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState<SettingsResult, FormData>(setGridTariff, {});
  useResultToast(state, s.price.gridSaved, s.charging.saveFailed);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- close the editor once the save went through
    if (state.success) setEditing(false);
  }, [state]);
  const value = (rate: number | null) =>
    rate == null ? s.price.gridNotSet : fill(s.price.perKwhValue, { price: formatNumber(rate, 2) });
  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="flex flex-col gap-2 text-left">
        {([
          [s.price.gridDay, s.price.gridDaySub, day],
          [s.price.gridNight, s.price.gridNightSub, night],
        ] as const).map(([label, sub, rate]) => (
          <span key={label} className="flex min-h-11 items-center justify-between gap-3">
            <span>
              <span className="block text-[15px]">{label}</span>
              <span className="block text-xs text-muted">{sub}</span>
            </span>
            <span className="text-sm text-muted">{value(rate)} ›</span>
          </span>
        ))}
      </button>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      {([
        ["grid-day", "gridDay", s.price.gridDay, s.price.gridDaySub, day],
        ["grid-night", "gridNight", s.price.gridNight, s.price.gridNightSub, night],
      ] as const).map(([id, name, label, sub, rate]) => (
        <div key={id} className="flex items-center justify-between gap-3">
          <label htmlFor={id} className="min-w-0">
            <span className="block text-[15px]">{label}</span>
            <span className="block text-xs text-muted">{sub}</span>
          </label>
          <input
            id={id}
            name={name}
            inputMode="decimal"
            placeholder="0,00"
            defaultValue={rate == null ? "" : formatNumber(rate, 2)}
            className={`${input} max-w-28 flex-none text-right`}
          />
        </div>
      ))}
      <p className="text-xs text-muted">{s.price.gridHelp}</p>
      <SubmitButton pendingLabel={nb.actions.working} className={`${smallButton} self-end`}>
        {s.price.save}
      </SubmitButton>
    </form>
  );
}


/** UC12: a push to this person's own devices, to check notifications work. */
export function TestNotificationButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await sendTestNotification();
          if (result.error) toast.error(s.notifications.testFailed, { description: result.error });
          else toast.success(s.notifications.testSent);
        })
      }
      className={`${smallButton} self-start disabled:opacity-60`}
    >
      {pending ? nb.actions.working : s.notifications.test}
    </button>
  );
}

const DEBUG_KEY = "zaptec-debug-enabled";

/**
 * Feilsøkingsmodus: the same localStorage flag ?debug=1 sets (which keeps
 * working), read by DebugProvider on Hjem.
 */
export function DebugModeSwitch() {
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists after mount
      setChecked(localStorage.getItem(DEBUG_KEY) === "1");
    } catch {
      // storage unavailable: stays off
    }
  }, []);
  return (
    <SwitchRow title={s.system.debug} sub={s.system.debugSub}>
      <Switch
        checked={checked}
        label={s.system.debug}
        onChange={(next) => {
          setChecked(next);
          try {
            localStorage.setItem(DEBUG_KEY, next ? "1" : "0");
          } catch {
            // ignore
          }
        }}
      />
    </SwitchRow>
  );
}
