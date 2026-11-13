"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { SimSnapshot } from "@/lib/mock/charger";
import type { MockLogEntry } from "@/lib/mock/store";
import type { PresetKey } from "@/lib/mock/presets";
import {
  mockApplyPreset,
  mockCronTick,
  mockFinishPlan,
  mockHealthCheck,
  mockResetAll,
  mockSim,
  mockSmartcarWebhook,
  mockZaptecSessionEnd,
  type SimAction,
} from "@/lib/mock/actions";
import { formatTime } from "@/lib/datetime";

const MODE_NAME: Record<number, string> = { 1: "Frakoblet", 2: "Tilkoblet, venter", 3: "Lader", 5: "Stoppet/hviler" };

const btn =
  "flex min-h-11 items-center justify-center rounded-[var(--radius-chip)] border border-border bg-surface px-3 text-sm font-semibold text-text disabled:opacity-50";
const btnAccent =
  "flex min-h-11 items-center justify-center rounded-[var(--radius-chip)] bg-accent px-3 text-sm font-semibold text-on-accent disabled:opacity-50";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">{title}</h2>
      {children}
    </section>
  );
}

export function MockPanel({
  presets,
  sim,
  log,
  db,
}: {
  presets: { key: string; label: string }[];
  sim: SimSnapshot;
  log: MockLogEntry[];
  db: {
    openPlans: { status: string; targetEnergyKwh: number; readyBy: string; note: string | null }[];
    openSessions: number;
    lastTickAt: string | null;
    webhooks: { eventType: string; receivedAt: string }[];
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [autoTick, setAutoTick] = useState(false);
  const [battery, setBattery] = useState(Math.round(sim.batteryPercent));

  const run = (fn: () => Promise<unknown>, okMessage?: string) =>
    startTransition(async () => {
      try {
        const result = await fn();
        if (typeof result === "string") toast.message(result);
        else if (okMessage) toast.success(okMessage);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
      router.refresh();
    });
  const simDo = (action: SimAction) => run(() => mockSim(action));

  // Live view while energy is flowing.
  useEffect(() => {
    if (sim.mode !== 3) return;
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [sim.mode, router]);

  // Optional stand-in for cron-job.org: a tick every 60 s while the panel is open.
  useEffect(() => {
    if (!autoTick) return;
    const id = setInterval(() => {
      mockCronTick()
        .then(() => router.refresh())
        .catch(() => undefined);
    }, 60_000);
    return () => clearInterval(id);
  }, [autoTick, router]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[28px] font-bold">Mock-kontroll</h1>
        <p className="text-sm text-muted">
          Ingen ekte lader, database, Smartcar, cron eller varsler. Alt ligger i minnet og nullstilles når dev-serveren
          startes på nytt.
        </p>
      </div>

      <Card title="Hopp til en tilstand">
        <div className="grid grid-cols-2 gap-2">
          {presets.map((p) => (
            <button key={p.key} type="button" disabled={pending} className={btn} onClick={() => run(() => mockApplyPreset(p.key as PresetKey), p.label)}>
              {p.label}
            </button>
          ))}
        </div>
        <button type="button" disabled={pending} className={btn} onClick={() => run(mockResetAll, "Nullstilt")}>
          Nullstill alt til startdata
        </button>
      </Card>

      <Card title="Innkommende kall">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={pending} className={btnAccent} onClick={() => run(mockCronTick)}>
            Kjør cron-tick
          </button>
          <button type="button" disabled={pending} className={btn} onClick={() => run(mockSmartcarWebhook)}>
            Smartcar-webhook
          </button>
          <button type="button" disabled={pending} className={btn} onClick={() => run(mockZaptecSessionEnd)}>
            Zaptec økt-slutt
          </button>
          <button type="button" disabled={pending} className={btn} onClick={() => run(mockHealthCheck)}>
            Helsesjekk
          </button>
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={autoTick} onChange={(e) => setAutoTick(e.target.checked)} className="h-5 w-5" />
          Automatisk cron-tick hvert minutt (mens denne siden er åpen)
        </label>
        <p className="text-xs text-muted">
          Sist tick: {db.lastTickAt ? formatTime(db.lastTickAt) : "aldri"} · Webhooks mottatt:{" "}
          {db.webhooks.length ? db.webhooks.map((w) => `${w.eventType} ${formatTime(w.receivedAt)}`).join(", ") : "ingen"}
        </p>
      </Card>

      <Card title="Lader og bil">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Status</dt>
          <dd>{sim.online ? (MODE_NAME[sim.mode] ?? sim.mode) : "Offline"}{sim.finalStopActive ? " (final stop)" : ""}</dd>
          <dt className="text-muted">Batteri (ekte)</dt>
          <dd>{sim.batteryPercent} %</dd>
          <dt className="text-muted">Smartcar-avlesning</dt>
          <dd>{sim.reading ? `${sim.reading.percent} % kl. ${formatTime(sim.reading.at)}` : "–"}</dd>
          <dt className="text-muted">Denne økten</dt>
          <dd>{sim.carConnected ? `${sim.sessionEnergyKwh.toFixed(2)} kWh` : "–"}</dd>
          <dt className="text-muted">Åpne planer / Lad nå</dt>
          <dd>
            {db.openPlans.length} / {db.openSessions}
          </dd>
        </dl>
        {db.openPlans.map((p, i) => (
          <p key={i} className="text-xs text-muted">
            Plan {p.status}: {p.targetEnergyKwh} kWh klar {formatTime(p.readyBy)}
            {p.note ? ` · ${p.note}` : ""}
          </p>
        ))}
        <div className="grid grid-cols-2 gap-2">
          {sim.carConnected ? (
            <button type="button" disabled={pending} className={btn} onClick={() => simDo({ type: "unplug" })}>
              Koble fra bil
            </button>
          ) : (
            <button type="button" disabled={pending} className={btn} onClick={() => simDo({ type: "plugIn" })}>
              Koble til bil
            </button>
          )}
          <button type="button" disabled={pending} className={btn} onClick={() => simDo({ type: "reportBattery" })}>
            Bilen rapporterer
          </button>
          <button type="button" disabled={pending} className={btn} onClick={() => simDo({ type: "addEnergy", kwh: 1 })}>
            +1 kWh
          </button>
          <button type="button" disabled={pending} className={btn} onClick={() => run(() => mockFinishPlan())}>
            Fullfør plan
          </button>
          <button type="button" disabled={pending} className={btn} onClick={() => simDo({ type: "carStopsDrawing" })}>
            Bilen slutter å trekke strøm
          </button>
          <button type="button" disabled={pending} className={btn} onClick={() => simDo({ type: "carIdlesWhileCharging" })}>
            Bilen trekker 0 A (modus 3)
          </button>
          <button type="button" disabled={pending} className={btn} onClick={() => simDo({ type: "carDrawsAgain" })}>
            Bilen trekker strøm igjen
          </button>
          <button type="button" disabled={pending} className={btn} onClick={() => simDo({ type: "authorise" })}>
            RFID-brikke
          </button>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Batteri: {battery} %
          <input
            type="range"
            min={0}
            max={100}
            value={battery}
            onChange={(e) => setBattery(Number(e.target.value))}
            onPointerUp={() => simDo({ type: "setBattery", percent: battery })}
            onKeyUp={() => simDo({ type: "setBattery", percent: battery })}
          />
        </label>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <label className="flex flex-col gap-1">
            Effekt
            <select className="min-h-11 rounded border border-border bg-surface px-2" value={sim.powerKw} onChange={(e) => simDo({ type: "setPower", kw: Number(e.target.value) })}>
              {[2.3, 3.6, 7.1, 11].map((kw) => (
                <option key={kw} value={kw}>{kw} kW</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Hastighet
            <select className="min-h-11 rounded border border-border bg-surface px-2" value={sim.speed} onChange={(e) => simDo({ type: "setSpeed", speed: Number(e.target.value) })}>
              {[1, 10, 60, 600].map((s) => (
                <option key={s} value={s}>×{s}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={sim.requiresAuth} onChange={(e) => simDo({ type: "setRequiresAuth", value: e.target.checked })} className="h-5 w-5" />
          Laderen krever innlogging (RFID)
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={sim.online} onChange={(e) => simDo({ type: "setOnline", value: e.target.checked })} className="h-5 w-5" />
          Laderen er online
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={sim.smartcarDown} onChange={(e) => simDo({ type: "setSmartcarDown", value: e.target.checked })} className="h-5 w-5" />
          Smartcar svarer ikke
        </label>
      </Card>

      <Card title="Logg (kommandoer, varsler, kall)">
        {log.length === 0 ? (
          <p className="text-sm text-muted">Ingenting ennå.</p>
        ) : (
          <ul className="flex flex-col gap-1 font-mono text-xs">
            {log.map((entry) => (
              <li key={entry.seq} data-log-seq={entry.seq} className={entry.kind === "push" ? "text-accent" : entry.kind === "command" ? "text-amber" : "text-text-2"}>
                {formatTime(entry.at)} [{entry.kind}] {entry.text}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
