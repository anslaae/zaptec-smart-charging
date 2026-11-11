import Link from "next/link";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { chargeSchedules, manualChargeSessions, schedulerHeartbeat } from "@/lib/db/schema";
import { getLearnedPowerKw } from "@/lib/scheduler/powerHistory.server";
import { STALE_AFTER_SECONDS } from "@/lib/scheduler/heartbeat";
import { effectivePluginMode, getSettings } from "@/lib/settings";
import { OnPluginSetting } from "@/components/OnPluginSetting";
import { getHomeContext } from "@/lib/places";
import { listChargers } from "@/lib/zaptec/client";
import { MOCK_MODE } from "@/lib/mock/mode";
import { NotificationToggle } from "@/components/NotificationToggle";
import { LogoutButton } from "@/components/LogoutButton";
import {
  DebugModeSwitch,
  GridTariffRows,
  LendChargerRow,
  PriceRow,
  TestNotificationButton,
} from "@/components/SettingsControls";
import { formatDayAndTime, formatKw, formatTime } from "@/lib/datetime";
import { nb, fill } from "@/lib/i18n/nb";

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-4 flex-col gap-2">
      <h2 className="px-1 text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">{title}</h2>
      <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">{children}</div>
    </section>
  );
}

function Row({ label, value, amber }: { label: string; value: string; amber?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[15px]">{label}</span>
      <span className={`text-right text-sm ${amber ? "text-amber" : "text-muted"}`}>{value}</span>
    </div>
  );
}

// Innstillinger (design/redesign/HANDOFF.md §5): Varsler, Strømpris, Lading,
// System, Konto. Household-wide settings live in the settings table; the
// notification switch and debug mode are per device.
export default async function SettingsPage() {
  const user = await getCurrentUser();
  const [heartbeat, learnedPowerKw, settings, chargers, openGuests, openPlans] = await Promise.all([
    db
      .select({ lastTickAt: schedulerHeartbeat.lastTickAt })
      .from(schedulerHeartbeat)
      .where(eq(schedulerHeartbeat.id, "singleton"))
      .then((rows) => rows[0] ?? null),
    getLearnedPowerKw(),
    getSettings(),
    listChargers(),
    db
      .select({ chargerId: manualChargeSessions.chargerId, guestName: manualChargeSessions.guestName })
      .from(manualChargeSessions)
      .where(and(eq(manualChargeSessions.kind, "guest"), isNull(manualChargeSessions.endedAt))),
    db
      .select({ chargerId: chargeSchedules.chargerId, readyBy: chargeSchedules.readyBy })
      .from(chargeSchedules)
      .where(inArray(chargeSchedules.status, ["pending", "active"])),
  ]);
  const home = await getHomeContext(chargers);
  const charger = chargers[0];
  const openPlan = charger ? openPlans.find((p) => p.chargerId === charger.id) : undefined;
  const openGuest = charger ? openGuests.find((g) => g.chargerId === charger.id) : undefined;

  const now = new Date();
  const lastTickAt = heartbeat?.lastTickAt ?? null;
  const stale = !lastTickAt || (now.getTime() - lastTickAt.getTime()) / 1000 > STALE_AFTER_SECONDS;
  const schedulerValue = lastTickAt
    ? stale
      ? fill(nb.heartbeat.stale, { time: formatTime(lastTickAt) })
      : fill(nb.settings.system.schedulerActive, { time: formatTime(lastTickAt) })
    : nb.heartbeat.never;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 pt-6 pb-4">
      <h1 className="text-[28px] font-bold">{nb.settings.title}</h1>

      <Section title={nb.settings.notifications.section}>
        <NotificationToggle />
        <TestNotificationButton />
        <p className="text-xs text-muted">{nb.settings.notifications.iosHint}</p>
      </Section>

      <Section title={nb.settings.price.section} id="price">
        <PriceRow price={settings.energyPriceNokPerKwh} />
        <GridTariffRows day={settings.gridDayNokPerKwh} night={settings.gridNightNokPerKwh} />
        <details className="group text-xs text-muted">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold text-text">
            {nb.settings.price.sourceTitle}
            <span aria-hidden className="text-muted transition-transform group-open:rotate-90">
              ›
            </span>
          </summary>
          <div className="flex flex-col gap-1.5 pb-1">
            <p>{nb.settings.price.sourceNorgespris}</p>
            <p>{nb.settings.price.sourceElvia}</p>
            <p>{nb.settings.price.sourceFixed}</p>
            <p>{nb.settings.price.sourceEstimate}</p>
            <a
              href="https://www.elvia.no/nettleie/alt-om-nettleiepriser/nettleiepriser-for-privatkunder/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-accent"
            >
              {nb.settings.price.sourceLink}
            </a>
          </div>
        </details>
      </Section>

      <Section title={nb.settings.charging.section}>
        {home.location && (
          <div className="flex min-h-11 items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-[15px]">{nb.settings.location.name}</span>
              <span className="block text-xs text-muted">{nb.settings.location.fromZaptec}</span>
            </span>
            <span className="truncate text-sm text-muted">{home.location.name}</span>
          </div>
        )}
        <OnPluginSetting
          data={{
            mode: effectivePluginMode(settings),
            untilIso: effectivePluginMode(settings) === "wait" ? null : (settings.onPluginModeUntil?.toISOString() ?? null),
            smartTargetPercent: settings.smartTargetPercent,
            smartReadyByWeekday: settings.smartReadyByWeekday,
            smartReadyByWeekend: settings.smartReadyByWeekend,
            location: home.location?.name ?? nb.app.name,
            cheapestNokPerKwh:
              settings.gridNightNokPerKwh != null ? settings.energyPriceNokPerKwh + settings.gridNightNokPerKwh : null,
            dearestNokPerKwh:
              settings.gridDayNokPerKwh != null ? settings.energyPriceNokPerKwh + settings.gridDayNokPerKwh : null,
          }}
        />
        {charger && (
          <LendChargerRow
            chargerId={charger.id}
            chargerName={charger.name}
            active={openGuest != null}
            guestName={openGuest?.guestName ?? null}
            carName={home.car?.name ?? "bilens"}
            planReadyBy={openPlan ? formatDayAndTime(openPlan.readyBy, now) : null}
          />
        )}
      </Section>

      <Section title={nb.settings.system.section}>
        <Row label={nb.settings.system.scheduler} value={schedulerValue} amber={stale} />
        <Row label={nb.settings.system.learnedRate} value={learnedPowerKw != null ? formatKw(learnedPowerKw) : "–"} />
        <Row
          label={nb.settings.system.version}
          value={`${process.env.BUILD_SHA ?? "unknown"} · ${process.env.BUILD_ENV ?? "unknown"}`}
        />
        <DebugModeSwitch />
        {MOCK_MODE && (
          <Link href="/dev/mock" className="flex min-h-11 items-center justify-between text-[15px]">
            {nb.settings.system.mock}
            <span className="text-sm text-muted">›</span>
          </Link>
        )}
      </Section>

      <Section title={nb.settings.account.section}>
        <Row label={user.name} value={user.email} />
        <LogoutButton />
      </Section>
    </main>
  );
}
