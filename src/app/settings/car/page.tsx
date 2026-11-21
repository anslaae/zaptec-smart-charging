import { verifySession } from "@/lib/auth/dal";
import { getDefaultCar } from "@/lib/places";
import { getSettings, pricesOf } from "@/lib/settings";
import { loadDriveReadings, loadSessionRecords } from "@/lib/records";
import { monthInsights, monthKeyOf } from "@/lib/ui/insights";
import { sinceUnplug } from "@/lib/ui/sinceUnplug";
import { loadBatteryReading, loadCarConnection, loadLastSmartcarWebhook } from "@/lib/ui/carCharger.server";
import { MiniRing } from "@/components/BatteryRing";
import { DetailHeader, DetailRow, DetailSection } from "@/components/SettingsDetail";
import { formatDuration, formatNumber, formatPastDayAndTime, formatPercent } from "@/lib/datetime";
import { fill, nb } from "@/lib/i18n/nb";

const t = nb.settings.car;
const DAY = 86_400_000;
// "Siste lading" looks this far back; older than that shows "–".
const LAST_CHARGE_DAYS = 120;

// Innstillinger → Bil (HANDOFF §6g): what the app knows about the car, from
// data it already has -- Smartcar's reading and vehicle_telemetry (from the
// car), the plug-in/unplug log and the session records (from the charger),
// and this month's figures computed exactly as Innsikt does. No Zaptec call.
export default async function CarPage() {
  await verifySession();
  const now = new Date();
  const [car, settings, connection, battery, lastWebhook] = await Promise.all([
    getDefaultCar(null),
    getSettings(),
    loadCarConnection(),
    loadBatteryReading(),
    loadLastSmartcarWebhook(),
  ]);
  const capacityKwh = car?.batteryCapacityKwh ?? 46;
  const [readings, { records }] = await Promise.all([
    loadDriveReadings(car?.id ?? null, new Date(now.getTime() - 30 * DAY)),
    loadSessionRecords(new Date(now.getTime() - LAST_CHARGE_DAYS * DAY), capacityKwh, pricesOf(settings), car?.id ?? null),
  ]);

  const reading = battery.reading;
  const percent = reading?.percent ?? null;
  const odometer = readings.findLast((r) => r.odometerKm != null) ?? null;
  const driven = sinceUnplug({ readings, lastUnplug: connection.unpluggedAt, now })?.drivenKm ?? null;
  // The newest of the API answer and the webhook (HANDOFF §6g).
  const smartcarUpdated = [battery.api?.oemUpdatedAt, lastWebhook].filter((d): d is Date => d != null).sort((a, b) => b.getTime() - a.getTime())[0];

  const lastCharge = records
    .filter((r) => r.tag !== "guest" && (r.kwh ?? 0) > 0 && (car == null || r.carId === car.id))
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
  const month = monthKeyOf(now);
  const m = monthInsights(records, month, now);
  const monthCount = records.filter((r) => (r.kwh ?? 0) > 0 && monthKeyOf(r.startedAt) === month).length;

  const header = [
    percent != null && reading ? fill(t.measured, { when: formatPastDayAndTime(reading.oemUpdatedAt, now) }) : null,
    percent != null ? fill(t.kwhLeft, { kwh: formatNumber((percent / 100) * capacityKwh, 0) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 pt-6 pb-4">
      <DetailHeader title={car?.name ?? nb.settings.carAndCharger.section} />

      <section className="flex items-center gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4" data-testid="car-header">
        <MiniRing
          percent={percent}
          size={76}
          unplugged={!connection.connected}
          label={percent != null ? formatPercent(percent) : nb.home.noCar.statusNoBattery}
        />
        <div className="min-w-0">
          <p className="text-[17px] font-semibold">{connection.connected ? t.connectedNow : nb.home.noCar.status}</p>
          {header && <p className="text-sm text-muted">{header}</p>}
          <p className="mt-1 text-xs text-muted">
            {car?.name ?? ""} · {fill(t.capacity, { kwh: formatNumber(capacityKwh, 0) })}
          </p>
        </div>
      </section>

      <DetailSection title={t.fromCar}>
        <DetailRow
          label={t.odometer}
          value={odometer ? fill(t.kmValue, { km: formatNumber(odometer.odometerKm!, 0) }) : t.none}
          sub={odometer ? fill(t.measured, { when: formatPastDayAndTime(odometer.at, now) }) : null}
        />
        <DetailRow label={t.drivenSinceCharge} value={driven != null ? fill(t.drivenValue, { km: formatNumber(driven, 0) }) : t.none} />
        <DetailRow
          label={t.smartcar}
          dot={battery.api ? "ok" : "off"}
          value={battery.api ? t.smartcarConnected : t.smartcarDisconnected}
          sub={smartcarUpdated ? fill(t.updated, { when: formatPastDayAndTime(smartcarUpdated, now) }) : null}
        />
      </DetailSection>

      <DetailSection title={t.atCharger}>
        {connection.connected ? (
          <DetailRow
            label={t.lastConnected}
            value={t.connectedNow}
            sub={connection.pluggedInAt ? fill(t.connectedNowSub, { when: formatPastDayAndTime(connection.pluggedInAt, now) }) : null}
          />
        ) : (
          <DetailRow
            label={t.lastConnected}
            value={connection.pluggedInAt ? formatPastDayAndTime(connection.pluggedInAt, now) : t.none}
            sub={
              connection.pluggedInAt && connection.unpluggedAt
                ? fill(t.lastConnectedSub, {
                    duration: formatDuration((connection.unpluggedAt.getTime() - connection.pluggedInAt.getTime()) / 1000),
                  })
                : null
            }
          />
        )}
        <DetailRow
          label={t.lastCharge}
          value={lastCharge ? formatPastDayAndTime(lastCharge.endedAt ?? lastCharge.startedAt, now) : t.none}
          sub={
            lastCharge
              ? fill(lastCharge.costNok != null ? t.lastChargeSub : t.lastChargeSubNoCost, {
                  kwh: formatNumber(lastCharge.kwh!, 1),
                  kind: nb.history.tags[lastCharge.tag],
                  cost: formatNumber(Math.round(lastCharge.costNok ?? 0), 0),
                })
              : null
          }
        />
        <DetailRow
          label={t.thisMonth}
          value={monthCount === 1 ? t.thisMonthValueOne : fill(t.thisMonthValue, { count: monthCount })}
          sub={fill(t.thisMonthSub, { kwh: formatNumber(m.totalKwh, 1), cost: formatNumber(Math.round(m.totalCostNok), 0) })}
        />
      </DetailSection>

      <p className="px-1 text-xs text-muted">{t.footnote}</p>
    </main>
  );
}
