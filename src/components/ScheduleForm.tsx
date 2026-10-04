"use client";

import { useActionState } from "react";
import { createSchedule, type CreateScheduleState } from "@/lib/schedules/actions";

const initialState: CreateScheduleState = {};

export function ScheduleForm({ chargers }: { chargers: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createSchedule, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {chargers.length > 1 && (
        <div className="flex flex-col gap-1">
          <label htmlFor="chargerId" className="text-sm font-medium">
            Charger
          </label>
          <select
            id="chargerId"
            name="chargerId"
            required
            className="rounded-md border border-black/10 bg-transparent px-3 py-2 text-base dark:border-white/15"
            onChange={(event) => {
              const form = event.currentTarget.form;
              if (!form) return;
              const nameInput = form.elements.namedItem("chargerName") as HTMLInputElement | null;
              const selected = chargers.find((c) => c.id === event.currentTarget.value);
              if (nameInput && selected) nameInput.value = selected.name;
            }}
          >
            {chargers.map((charger) => (
              <option key={charger.id} value={charger.id}>
                {charger.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {chargers.length <= 1 && (
        <input type="hidden" name="chargerId" value={chargers[0]?.id ?? ""} />
      )}
      <input type="hidden" name="chargerName" value={chargers[0]?.name ?? ""} />

      <div className="flex flex-col gap-1">
        <label htmlFor="targetEnergyKwh" className="text-sm font-medium">
          Charge how much? (kWh)
        </label>
        <input
          id="targetEnergyKwh"
          name="targetEnergyKwh"
          type="number"
          step="0.1"
          min="0.1"
          max="200"
          required
          placeholder="e.g. 20"
          className="rounded-md border border-black/10 bg-transparent px-3 py-2 text-base dark:border-white/15"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="readyBy" className="text-sm font-medium">
          Ready by
        </label>
        <input
          id="readyBy"
          name="readyBy"
          type="datetime-local"
          required
          className="rounded-md border border-black/10 bg-transparent px-3 py-2 text-base dark:border-white/15"
        />
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <button
        type="submit"
        disabled={pending || chargers.length === 0}
        className="rounded-md bg-foreground px-4 py-2 text-base font-medium text-background disabled:opacity-60"
      >
        {pending ? "Saving…" : "Create schedule"}
      </button>
      {chargers.length === 0 && (
        <p className="text-sm text-red-600">No chargers found on the connected Zaptec account.</p>
      )}
    </form>
  );
}
