import { Suspense } from "react";
import { desc, eq, inArray, isNull } from "drizzle-orm";
import { getCurrentUser, verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { activityEvents, chargeSchedules, manualChargeSessions, schedulerHeartbeat, users } from "@/lib/db/schema";
import { ActivityType } from "@/lib/activity/log";
import { sinceUnplug } from "@/lib/ui/sinceUnplug";
import { newerReading } from "@/lib/smartcar/state";
import { visibleActivity } from "@/lib/ui/activity";
import { loadDriveReadings, planDeliveredKwh } from "@/lib/records";
import { reachedPercent } from "@/lib/push/notifications";
import { sessionCost } from "@/lib/pricing";
import { listChargers, getChargerState } from "@/lib/zaptec/client";
import { getStateOfCharge } from "@/lib/smartcar/client";
import { estimateChargingPlan, planDeliveredNow, plannedPowerKw } from "@/lib/scheduler/engine";
import { getLearnedPowerKw } from "@/lib/scheduler/powerHistory.server";
import { HOUSEHOLD_TIME_ZONE, formatDayAndTime, formatTime, tomorrowAtLocalValue, zonedDateTimeToUtc } from "@/lib/datetime";
import { getSettings, pricesOf } from "@/lib/settings";
import { getHomeContext } from "@/lib/places";
import { estimateBattery } from "@/lib/ui/battery";
import { buildSuggestion } from "@/lib/ui/suggestion";
import type { SmartBlocks } from "@/lib/scheduler/smartRun";
import { isCurrentlyCharging } from "@/lib/zaptec/state";
import { chargeToRideAlong } from "@/lib/preheat";
import { preheatHoldActive, preheatHoldEnd, preheatHoldEstimate } from "@/lib/scheduler/preheatHold";
import { preheatPowerCheck } from "@/lib/scheduler/preheatPower";
import { ChargerOperationMode } from "@/lib/zaptec/constants";
import type { HomeCardData } from "@/lib/ui/homeData";
import type { SessionKind } from "@/lib/sessions";
import { AppHeader } from "@/components/AppHeader";
import { HomeCard } from "@/components/HomeCard";
import { RecentActivity } from "@/components/RecentActivity";
import { ScheduleCreatedToast } from "@/components/ScheduleCreatedToast";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DebugProvider } from "@/components/DebugProvider";
import { LentOutSheet, PlanInProgressSheet, PlanSheet, type PlanSheetData } from "@/components/PlanSheet";
import { ChargeNowSheet, PreheatSheet, type PreheatSheetData } from "@/components/PreheatSheet";
import { nb } from "@/lib/i18n/nb";
import { loadLoopGuard } from "@/lib/scheduler/loopGuard.server";

// Plan sheet's starting "Klar til" (owner decision D56); "Bruk" keeps last plan's time.
const DEFAULT_READY_TIME = "08:00";

/** "HH:MM" of a timestamp on the Oslo wall clock, as numbers. */
function osloClock(date: Date): { hour: number; minute: number } {
  const [hour, minute] = formatTime(date).split(":").map(Number);
  return { hour, minute };
}

// Hjem. Sheets open over it from the URL (design/redesign/HANDOFF.md
// "Sheets, not pages") so push notifications can deep-link:
//   ?sheet=plan        Planlegg / Endre plan (edits the open plan if there is one)
//   ?sheet=preheat     Forvarm
//   ?action=charge-now the "Lad nå" push action (asks before starting)
export default async function HomePage({ searchParams }: PageProps<"/">) {
  await verifySession();
  const now = new Date();
  const params = await searchParams;
  const sheet = params.sheet === "plan" || params.sheet === "preheat" ? params.sheet : null;
  const chargeNowAction = params.action === "charge-now";

  const [user, chargers, openSchedules, heartbeat, apiStateOfCharge, learnedPowerKw, openSessions, completed, recent, settings, telemetry, lastUnplug, people] =
    await Promise.all([
      getCurrentUser(),
      listChargers(),
      db
        .select()
        .from(chargeSchedules)
        .where(inArray(chargeSchedules.status, ["pending", "active"]))
        .orderBy(chargeSchedules.readyBy),
      db
        .select({ lastTickAt: schedulerHeartbeat.lastTickAt })
        .from(schedulerHeartbeat)
        .where(eq(schedulerHeartbeat.id, "singleton"))
        .then((rows) => rows[0] ?? null),
      getStateOfCharge(),
      getLearnedPowerKw(),
      db.select().from(manualChargeSessions).where(isNull(manualChargeSessions.endedAt)),
      db
        .select()
        .from(chargeSchedules)
        .where(eq(chargeSchedules.status, "completed"))
        .orderBy(desc(chargeSchedules.endedAt))
        .limit(10),
      db
        .select({
          id: activityEvents.id,
          type: activityEvents.type,
          userId: activityEvents.userId,
          detail: activityEvents.detail,
          createdAt: activityEvents.createdAt,
        })
        .from(activityEvents)
        .orderBy(desc(activityEvents.createdAt))
        // Enough to find two after leaving out technical events and repeats.
        .limit(40),
      getSettings(),
      // "Koblet fra" (noCar): readings from the last 30 days; sinceUnplug() picks the window.
      loadDriveReadings(null, new Date(now.getTime() - 30 * 86_400_000)),
      db
        .select({ chargerId: activityEvents.chargerId, createdAt: activityEvents.createdAt })
        .from(activityEvents)
        .where(eq(activityEvents.type, ActivityType.Unplugged))
        .orderBy(desc(activityEvents.createdAt))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db.select({ id: users.id, name: users.name }).from(users),
    ]);

  // The live API reading, or the latest webhook reading when that's newer or the
  // API call failed -- otherwise a failed call empties the ring for one render.
  const lastStored = telemetry.findLast((r) => r.batteryPercent != null && r.batteryAt != null);
  const stateOfCharge = newerReading(
    apiStateOfCharge,
    lastStored ? { percent: lastStored.batteryPercent!, oemUpdatedAt: lastStored.batteryAt! } : null,
  );

  const [chargerStates, home] = await Promise.all([
    Promise.all(chargers.map((c) => getChargerState(c.id, c.isOnline, c.circuitId, c.installationId))),
    getHomeContext(chargers),
  ]);
  const guards = await Promise.all(chargers.map((c, i) => loadLoopGuard(c.id, now, chargerStates[i].sessionId)));
  const capacityKwh = home.car?.batteryCapacityKwh ?? 46;

  const cards: HomeCardData[] = chargers.map((charger, index) => {
    const state = chargerStates[index];
    // createSchedule() rejects overlapping schedules per charger, so there's
    // at most one pending/active plan per charger.
    const schedule = openSchedules.find((s) => s.chargerId === charger.id) ?? null;
    const deliveredKwh = schedule
      ? planDeliveredNow(
          {
            zaptecSessionId: schedule.zaptecSessionId,
            priorSessionEnergyKwh: Number(schedule.priorSessionEnergyKwh ?? 0),
            lastObservedSessionEnergyKwh: Number(schedule.lastObservedSessionEnergyKwh ?? 0),
          },
          state,
        )
      : 0;
    const plan = schedule
      ? estimateChargingPlan(
          {
            targetEnergyKwh: Number(schedule.targetEnergyKwh),
            readyBy: schedule.readyBy,
          },
          // A plan counts only energy delivered after it was made (see
          // createSchedule's baseline): the remaining kWh uses that total.
          { ...state, sessionEnergyKwh: deliveredKwh },
          learnedPowerKw,
        )
      : null;

    // A guest window wins over any other open row (it holds plans back too).
    const sessions = openSessions
      .filter((s) => s.chargerId === charger.id)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    const session = sessions.find((s) => s.kind === "guest") ?? sessions[0];

    const lastCompleted = completed.find((s) => s.chargerId === charger.id) ?? null;
    let suggestion: HomeCardData["suggestion"] = null;
    const suggested = lastCompleted
      ? buildSuggestion({
          lastPlan: { targetPercent: lastCompleted.targetPercent, targetKwh: Number(lastCompleted.targetEnergyKwh) },
          batteryPercent: estimateBattery({
            reading: stateOfCharge,
            capacityKwh,
            now,
            charging: isCurrentlyCharging(state),
            sessionEnergyKwh: state.sessionEnergyKwh,
            chargeDurationSeconds: state.chargeDurationSeconds,
            remainingPlanKwh: null,
          }).percent,
          capacityKwh,
        })
      : null;
    if (lastCompleted && suggested) {
      const { hour, minute } = osloClock(lastCompleted.readyBy);
      const readyByLocal = tomorrowAtLocalValue(HOUSEHOLD_TIME_ZONE, hour, minute);
      suggestion = {
        ...suggested,
        readyByLocal,
        readyByIso: zonedDateTimeToUtc(readyByLocal, HOUSEHOLD_TIME_ZONE).toISOString(),
      };
    }

    // D67 hold / D68 "on battery": the same checks the tick makes, on the live state.
    const holdOn =
      schedule != null &&
      preheatHoldActive({ holdUntil: schedule.preheatHoldUntil, scheduleSessionId: schedule.zaptecSessionId, state, now });
    const preheatSession = sessions.find((s) => s.kind === "preheat");
    const preheatPower = preheatSession
      ? preheatPowerCheck({
          state,
          lostAt: preheatSession.powerLostAt,
          notifiedAt: preheatSession.powerLostNotifiedAt,
          startedAt: preheatSession.startedAt,
          now,
        })
      : holdOn
        ? preheatPowerCheck({
            state,
            lostAt: schedule!.preheatPowerLostAt,
            notifiedAt: schedule!.preheatPowerLostNotifiedAt,
            startedAt: null,
            now,
          })
        : null;

    return {
      chargerId: charger.id,
      chargerName: charger.name,
      nowIso: now.toISOString(),
      state,
      schedule: schedule
        ? {
            id: schedule.id,
            status: schedule.status,
            targetEnergyKwh: Number(schedule.targetEnergyKwh),
            readyByIso: schedule.readyBy.toISOString(),
            lastError: schedule.lastError,
            deliveredKwh,
            targetPercent: schedule.targetPercent,
            source: schedule.source,
            smart: schedule.source === "smart" && schedule.blocks ? (schedule.blocks as SmartBlocks) : null,
            preheatHoldUntilIso: holdOn ? schedule.preheatHoldUntil!.toISOString() : null,
          }
        : null,
      startTimeIso: schedule?.status === "pending" && plan ? plan.latestStartTime.toISOString() : null,
      // The scheduler already starts the moment latestStartTime arrives, even
      // if that's in the past when the plan is made -- this only tells the
      // household that's what's about to happen.
      startsImmediately: schedule?.status === "pending" && plan ? plan.latestStartTime <= now : false,
      openSession: session
        ? { kind: session.kind as SessionKind, startedAtIso: session.startedAt.toISOString(), guestName: session.guestName }
        : null,
      lastCompletedPlanSessionId: lastCompleted?.zaptecSessionId ?? null,
      stateOfCharge: stateOfCharge
        ? { percent: stateOfCharge.percent, oemUpdatedAtIso: stateOfCharge.oemUpdatedAt.toISOString() }
        : null,
      learnedPowerKw,
      suggestion,
      capacityKwh,
      prices: pricesOf(settings),
      // "trip" only shows between the tick that trips and the next one.
      automationPaused: guards[index] !== "ok",
      preheatOnBattery: preheatPower?.onBattery ?? false,
      sinceUnplug: sinceUnplug({
        readings: telemetry,
        lastUnplug: lastUnplug?.chargerId === charger.id ? lastUnplug.createdAt : null,
        now,
      }),
      lastPlan: lastCompleted
        ? (() => {
            const delivered = planDeliveredKwh(lastCompleted);
            return {
              id: lastCompleted.id,
              startPercent: lastCompleted.startPercent,
              targetPercent: lastCompleted.targetPercent,
              reachedPercent:
                delivered != null
                  ? reachedPercent({
                      startPercent: lastCompleted.startPercent,
                      targetPercent: lastCompleted.targetPercent,
                      deliveredKwh: delivered,
                      capacityKwh,
                    })
                  : null,
              deliveredKwh: delivered,
              startedAtIso: lastCompleted.startedAt?.toISOString() ?? null,
              endedAtIso: lastCompleted.endedAt?.toISOString() ?? null,
              readyByIso: lastCompleted.readyBy.toISOString(),
              byName: people.find((p) => p.id === lastCompleted.createdByUserId)?.name ?? null,
              carName: home.car?.name ?? null,
              costNok:
                delivered != null && lastCompleted.startedAt
                  ? sessionCost(delivered, lastCompleted.startedAt, lastCompleted.endedAt, pricesOf(settings)).totalNok
                  : null,
            };
          })()
        : null,
    };
  });

  // The sheets act on the first charger -- one location, one charger today
  // (HANDOFF §7: no picker until there's more than one).
  const first = cards[0];
  const openPlanReadyBy =
    first?.schedule && (first.schedule.status === "pending" || first.schedule.status === "active")
      ? formatDayAndTime(first.schedule.readyByIso, now)
      : null;
  let sheetNode: React.ReactNode = null;
  if (first && sheet === "plan" && first.openSession?.kind === "guest") {
    sheetNode = <LentOutSheet chargerId={first.chargerId} chargerName={first.chargerName} />;
  } else if (
    first &&
    sheet === "plan" &&
    first.schedule?.status === "active" &&
    isCurrentlyCharging(first.state)
  ) {
    // A plan that's charging isn't edited (D55): the sheet offers to stop it.
    sheetNode = (
      <PlanInProgressSheet
        plan={{
          id: first.schedule.id,
          targetPercent: first.schedule.targetPercent,
          targetKwh: first.schedule.targetEnergyKwh,
          readyByIso: first.schedule.readyByIso,
        }}
        nowIso={first.nowIso}
      />
    );
  } else if (first && sheet === "plan") {
    const state = first.state;
    const battery = estimateBattery({
      reading: stateOfCharge,
      capacityKwh,
      now,
      charging: isCurrentlyCharging(state),
      sessionEnergyKwh: state.sessionEnergyKwh,
      chargeDurationSeconds: state.chargeDurationSeconds,
      remainingPlanKwh: null,
    });
    const data: PlanSheetData = {
      chargerId: first.chargerId,
      chargerName: first.chargerName,
      nowIso: first.nowIso,
      connected: state.operationMode !== ChargerOperationMode.Disconnected,
      battery:
        battery.percent != null && stateOfCharge
          ? { percent: battery.percent, measuredAtIso: stateOfCharge.oemUpdatedAt.toISOString(), approx: battery.approx }
          : null,
      capacityKwh,
      powerKw: plannedPowerKw(learnedPowerKw, state.maxPowerKw),
      plan: first.schedule
        ? {
            id: first.schedule.id,
            targetPercent: first.schedule.targetPercent,
            targetKwh: first.schedule.targetEnergyKwh,
            readyByIso: first.schedule.readyByIso,
          }
        : null,
      defaultTime: DEFAULT_READY_TIME,
    };
    sheetNode = <PlanSheet key={first.schedule?.id ?? "new"} data={data} />;
  } else if (first && sheet === "preheat") {
    const kw = first.state.instantPowerWatts ? first.state.instantPowerWatts / 1000 : null;
    // D67: already charging? Under a plan / Smart lading Forvarm offers a hold
    // on the power (with what it may add); under Lad nå etc. it's just on.
    const openPlanRow =
      first.schedule && (first.schedule.status === "pending" || first.schedule.status === "active") ? first.schedule : null;
    const riding = chargeToRideAlong({
      charging: isCurrentlyCharging(first.state),
      openKinds: first.openSession ? [first.openSession.kind] : [],
      scheduleSources: openPlanRow ? [openPlanRow.source] : [],
    });
    let preheatWhileCharging: PreheatSheetData["alreadyCharging"] = null;
    if (riding === "plan" || riding === "smart") {
      const holdOn = openPlanRow!.preheatHoldUntilIso;
      const until = holdOn ? new Date(holdOn) : preheatHoldEnd(now, new Date(openPlanRow!.readyByIso));
      if (until) {
        const battery = estimateBattery({
          reading: stateOfCharge,
          capacityKwh,
          now,
          charging: true,
          sessionEnergyKwh: first.state.sessionEnergyKwh,
          chargeDurationSeconds: first.state.chargeDurationSeconds,
          remainingPlanKwh: null,
        });
        preheatWhileCharging = {
          kind: "hold",
          untilIso: until.toISOString(),
          active: holdOn != null,
          targetPercent: openPlanRow!.targetPercent,
          estimate: preheatHoldEstimate({
            now,
            until,
            powerKw: kw ?? plannedPowerKw(learnedPowerKw, first.state.maxPowerKw),
            prices: pricesOf(settings),
            roomKwh: battery.percent != null ? (capacityKwh * (100 - battery.percent)) / 100 : null,
          }),
        };
      } else preheatWhileCharging = { kind: "on" };
    } else if (riding) preheatWhileCharging = { kind: "on" };
    sheetNode = (
      <PreheatSheet
        data={{
          chargerId: first.chargerId,
          chargerName: first.chargerName,
          connected: first.state.operationMode !== ChargerOperationMode.Disconnected,
          preheating:
            first.openSession?.kind === "preheat" ? { startedAtIso: first.openSession.startedAtIso, kw } : null,
          alreadyCharging: preheatWhileCharging,
          onBattery: first.preheatOnBattery ?? false,
          planReadyBy: openPlanReadyBy,
        }}
      />
    );
  } else if (first && chargeNowAction) {
    sheetNode = <ChargeNowSheet data={{ chargerId: first.chargerId, chargerName: first.chargerName, planReadyBy: openPlanReadyBy }} />;
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 pt-6 pb-4">
      <AutoRefresh renderedAtIso={now.toISOString()} />
      <Suspense fallback={null}>
        <ScheduleCreatedToast />
      </Suspense>
      <DebugProvider buildSha={process.env.BUILD_SHA ?? "unknown"} buildEnv={process.env.BUILD_ENV ?? "unknown"}>
        <AppHeader
          userName={user.name}
          title={home.location?.name || chargers[0]?.installationName || nb.app.name}
          lastTickAt={heartbeat?.lastTickAt ?? null}
          now={now}
        />

        {cards.length === 0 && <p className="text-sm text-muted">{nb.home.noChargers}</p>}
        {cards.map((card) => (
          <HomeCard key={card.chargerId} data={card} />
        ))}

        <RecentActivity
          events={visibleActivity(recent)
            .filter((r) => !r.technical)
            .slice(0, 2)
            .map((r) => r.event)}
          now={now}
        />
      </DebugProvider>
      {sheetNode}
    </main>
  );
}
