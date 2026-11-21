import { verifySession } from "@/lib/auth/dal";
import { getChargerState, listChargers } from "@/lib/zaptec/client";
import { chargerHealth } from "@/lib/zaptec/health";
import { isCurrentlyCharging } from "@/lib/zaptec/state";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import { getLearnedPowerDetails } from "@/lib/scheduler/powerHistory.server";
import { plannedPowerKw } from "@/lib/scheduler/engine";
import { activePowerSource, circuitLimit, POWER_CHAIN, type PowerSource } from "@/lib/ui/carCharger";
import { loadLastObservedPower } from "@/lib/ui/carCharger.server";
import { DetailHeader, DetailRow, DetailSection } from "@/components/SettingsDetail";
import { PowerDotPlot } from "@/components/PowerDotPlot";
import { formatKw, formatPastDayAndTime } from "@/lib/datetime";
import { fill, nb } from "@/lib/i18n/nb";

const t = nb.settings.charger;

// Innstillinger → Lader (HANDOFF §6g): what the plans assume about the
// charge rate and why, the D73 health line and the last power measured.
// Read-only. One /state read per view, like Innstillinger (D73); the rest
// is the database (learned rate, charger_state_log).
export default async function ChargerPage() {
  await verifySession();
  const now = new Date();
  const chargers = await listChargers();
  const charger = chargers[0];
  const [state, details, lastPower] = await Promise.all([
    charger
      ? getChargerState(charger.id, charger.isOnline, charger.circuitId, charger.installationId).catch(() => null)
      : Promise.resolve(null),
    getLearnedPowerDetails(),
    charger ? loadLastObservedPower(charger.id) : Promise.resolve(null),
  ]);

  const health = state
    ? chargerHealth({
        isOnline: state.isOnline,
        warnings: state.health?.warnings ?? null,
        notifications: state.health?.notifications ?? null,
        signalDbm: state.health?.signalDbm ?? null,
      })
    : null;
  const plannedKw = plannedPowerKw(details.kw, state?.maxPowerKw);
  const defaultKw = plannedPowerKw(null, null);
  const active = activePowerSource(state, details.kw);
  const limit = circuitLimit(state);
  const observedKw = state?.instantPowerWatts && state.instantPowerWatts > 0 ? state.instantPowerWatts / 1000 : null;
  const connected = state != null && state.operationMode !== ChargerOperationMode.Disconnected;
  const samples = details.samples;
  const newest = samples.reduce<Date | null>((latest, s) => (!latest || s.endedAt > latest ? s.endedAt : latest), null);

  const chain: Record<PowerSource, { title: string; sub: string; value: string }> = {
    observed: { title: t.chainObserved, sub: t.chainObservedSub, value: observedKw != null ? formatKw(observedKw) : "–" },
    learned: { title: t.chainLearned, sub: t.chainLearnedSub, value: details.kw != null ? formatKw(details.kw) : "–" },
    circuit: {
      title: t.chainCircuit,
      sub: limit
        ? fill(t.chainCircuitSub, { amps: limit.amps, phases: limit.phases })
        : state?.maxPowerKw != null
          ? t.chainCircuitNoPhases
          : t.chainCircuitUnknown,
      value: state?.maxPowerKw != null ? formatKw(state.maxPowerKw) : "–",
    },
    default: { title: t.chainDefault, sub: t.chainDefaultSub, value: formatKw(defaultKw) },
  };
  const reason = {
    observed: t.reasonObserved,
    learned: connected ? t.reasonLearned : t.reasonLearnedNoCar,
    circuit: t.reasonCircuit,
    default: t.reasonDefault,
  }[active];

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 pt-6 pb-4">
      <DetailHeader title={charger?.name ?? nb.health.label} />

      <section aria-labelledby="estimate-title" className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <p className="text-[15px] text-muted">
          <span id="estimate-title">{t.estimateTitle}</span>
        </p>
        <p className="text-[34px] leading-tight font-bold tabular-nums" data-testid="planned-kw">
          {formatKw(plannedKw)}
        </p>
        <p className="text-sm text-muted">{t.estimateSub}</p>
        {details.kw == null ? (
          <p className="mt-3 text-sm text-muted">{t.estimateNoHistory}</p>
        ) : samples.length > 0 ? (
          <>
            <PowerDotPlot values={samples.map((s) => s.kw)} />
            <p className="mt-3 text-xs text-muted">
              {fill(samples.length === 1 ? t.estimateBasisOne : t.estimateBasis, {
                count: samples.length,
                when: newest ? formatPastDayAndTime(newest, now) : "–",
              })}
            </p>
          </>
        ) : null}
      </section>

      <section aria-labelledby="chain-title" className="flex flex-col gap-2">
        <h2 id="chain-title" className="px-1 text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">
          {t.chainTitle}
        </h2>
        <div className="rounded-[var(--radius-card)] border border-border bg-surface px-4 py-2">
          <ol className="flex flex-col divide-y divide-divider">
            {POWER_CHAIN.map((source, i) => {
              const row = chain[source];
              const on = source === active;
              return (
                <li key={source} data-source={source} aria-current={on ? "true" : undefined} className="flex items-center gap-3 py-3">
                  <span
                    aria-hidden
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                      on ? "bg-accent text-on-accent" : "border border-border text-muted"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[15px] ${on ? "font-bold" : ""}`}>
                      {row.title}
                      {on && <span className="sr-only"> ({t.inUse})</span>}
                    </span>
                    <span className="block text-xs text-muted">{row.sub}</span>
                  </span>
                  <span className={`shrink-0 text-sm tabular-nums ${on ? "font-bold text-text" : "text-muted"}`}>{row.value}</span>
                </li>
              );
            })}
          </ol>
          <p className="pt-1 text-xs text-muted">{t.chainNote}</p>
          <p className="pt-1 pb-2 text-sm font-semibold" data-testid="chain-reason">
            {reason}
          </p>
        </div>
      </section>

      <DetailSection title={t.status}>
        {health && (
          <DetailRow label={nb.health.label} value={<span className={health.level !== "ok" ? "text-amber" : ""}>{health.detail}</span>} />
        )}
        <DetailRow
          label={t.lastPower}
          value={lastPower ? formatKw(lastPower.kw) : "–"}
          sub={
            lastPower
              ? fill(t.lastPowerSub, {
                  when: formatPastDayAndTime(lastPower.at, now),
                  context:
                    state && isCurrentlyCharging(state) && now.getTime() - lastPower.at.getTime() < 15 * 60_000
                      ? t.lastPowerCharging
                      : t.lastPowerSession,
                })
              : t.lastPowerNone
          }
        />
      </DetailSection>
    </main>
  );
}
