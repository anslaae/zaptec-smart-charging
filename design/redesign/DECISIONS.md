# Lading redesign – decisions and open questions

Running log for the redesign build (HANDOFF.md steps 1–7). Newest at the bottom of each section. **Open questions** need the owner; **decisions** were taken while building and can be reversed.

## Open questions

| # | Question | Where it matters | What the build does meanwhile |
| --- | --- | --- | --- |
| Q5 | Production migrations `0013`–`0019` | Shipping | Migrations `0013`–`0019` are generated, **not applied**. **Run them before deploying the code** — the new tick reads the new columns, so code without the migration fails every tick (the heartbeat now goes stale when that happens, instead of looking healthy). Additive only; one data statement tags old preheat sessions. |

Answered by the owner (2026-11-11, round 2): Q2 editing a charging plan → stop it and make a new one (D55); Q3 → confirmed from production data (D57); Q4 own records are fine; Q10 → 08:00 (D56); Q12 → "Smart lading" as its own row, no "(ingen person)" anywhere.

Answered by the owner (2026-11-11): Q8/location name → read-only from Zaptec (D52); Q11 no battery reading → plan anyway (D53); Q13 → no dialog for the automatic choices (D51).

Answered by the owner (2026-11-10): Q1 nettleie → estimate it (D30); Q6 lending vs plans → mutually exclusive (D29); Q7 ~0 kWh sessions → hide (D28); Q9 Bruk → reuse target % and time with the battery now (D31).

## Decisions

| # | Decision | Why | Reversible? |
| --- | --- | --- | --- |
| D1 | Data model (§7) built **first**, not last | Steps 3, 5 and 6 need settings, car capacity, `kind` and the notification flags | Yes |
| D2 | Plans store `start_percent` / `target_percent` next to kWh | History "41 → 80 %", "Lader til 80 %" notifications and the % suggestion card need them | Yes (nullable) |
| D3 | `manual_charge_sessions.kind` ∈ manual / preheat / guest / automatic, plus recorded kWh | One authorisation table for every non-plan session; UC14 automatic sessions and UC15 guest windows are rows in it, so enforcement, history and per-person totals share one mechanism | Yes |
| D4 | UC14 "automatic" sessions open a `kind=automatic` row (no person) instead of being skipped silently | Their energy is recorded and they're excluded from per-person totals by kind | Yes |
| D5 | Settings, location and car rows are created lazily on first read (location from the Zaptec installation name, car from `vehicle.ts` + `SMARTCAR_VEHICLE_ID`) | No env-dependent seed SQL in the migration | Yes |
| D6 | A plan counts only energy delivered **after** it was made. When the car is mid-session (after Lad nå, or editing a charging plan), `createSchedule` stores the session's kWh so far as a negative `prior_session_energy_kwh` baseline | Without it the scheduler subtracted energy delivered before the plan existed and stopped early (affected the old form too). Answers Q2: an edited plan starts from the battery % in the sheet | Yes |
| D7 | `?sheet=plan` always edits the open plan when there is one (one plan per charger); no `?edit=id` param | Simpler deep links; push "Planlegg" lands in the right sheet either way | Yes |
| D8 | The "Lad nå" push action opens a confirm sheet (`?action=charge-now`) instead of starting charging from the URL | A link or a prefetch must never send a charger command | Yes |
| D9 | Forvarm on Hjem starts power with one tap and then opens the Forvarm sheet (no confirm dialog any more); opening `?sheet=preheat` directly offers the start button in step 1 | The sheet explains what happens, so the old `confirm()` was redundant | Yes |
| D10 | Guest window (UC15) is its own Hjem state `guest` with "Avslutt utlån"; plans are skipped by the tick while it's open and the charger is started once when the guest plugs in (if latched off) | Plans must not fight the guest's car; free charging may still be latched by an earlier enforcement stop | Yes |
| D11 | Turning "Tillat automatisk lading" off closes any open automatic session, so enforcement stops it on the next tick | The switch should mean what it says right away | Yes |
| D12 | Automatic sessions (UC14) show on Hjem like Lad nå ("Lader automatisk · kW", Stopp lading) | Someone may want to stop it; no new layout needed | Yes |
| D13 | Plan-sheet start time uses learned kW, else the circuit max, else 7 kW (`plannedPowerKw`), with the scheduler's 15-min safety margin | Same numbers the scheduler acts on | Yes |
| D14 | Notification percentages: "Ladet til ca. X %" = start % + delivered kWh / capacity; plans without % (older ones, Bruk-suggestion) fall back to kWh wording | Reports what actually happened, not just the target | Yes |
| D15 | Historikk "Økter": this week and last week as cards with totals; older months collapse to one row each ("Oktober 22 økter · 274 kWh ›", expandable) | Matches the mockup; 12 months loaded | Yes |
| D16 | Plans from before the redesign (no energy tracker) count their target kWh when completed; old manual sessions show "– kWh" | Better than hiding them; new rows always have measured kWh | Yes |
| D17 | kr is rounded to whole kroner in Historikk/Innsikt/notifications; Hjem's live "Kostnad" keeps øre | Matches the mockup ("24 kr") | Yes |
| D18 | "Send testvarsel" goes only to the signed-in person's devices | Testing your own phone shouldn't buzz everyone | Yes |
| D19 | All Hjem action buttons handle their result after the awaited call (shared `ActionButton`) instead of in an effect | Found by the UI tests: "Stopp lading", "Avbryt plan", "Avslutt utlån" change the state that renders them, so the old toast never showed | — (bug fix) |
| D20 | UI tests are Playwright against mock mode, using the installed Microsoft Edge (`channel: msedge`), run with `npm run test:ui` | No browser download; same mock the manual testing uses | Yes |
| D21 | "i natt" = a time before 06:00 that is still ahead and < 12 h away | Use-case doc lists "i natt" among the relative words | Yes |
| D22 | Charging ring shows a light highlight sweeping along the arc while charging, hidden under reduced motion | Use-case doc: "animated sweep while charging" | Yes |
| D23 | Innsikt "Per person" also shows an "Automatisk (ingen person)" row when there is automatic energy; it's in the month total but nobody's share | HANDOFF: automatic excluded from per-person; totals should still add up | Yes |
| D24 | Review fixes (independent code review of the tick): heartbeat written after enforcement; a row bound to an old physical session is closed instead of authorising the new car; the energy tracker is left untouched while no session is reported, and a lower reading for the same session is ignored; warning pushes are sent only after their once-per-plan flag is saved; GuestEnded logged once | Each was a concrete failure path (fail-open on a missing migration, a stale row waving a new car through, a plan over-delivering after an offline tick, repeated pushes) | — (bug fixes) |
| D25 | UC14 with the charger latched off by an earlier stop: on the plug-in tick only, open the automatic row and send ResumeCharging once | Otherwise "Tillat automatisk lading" silently did nothing after any enforcement stop; restricting it to the plug-in never restarts a car someone stopped | Yes |
| D26 | Hjem shows plan progress from the same reconciliation the tick uses (`planDeliveredNow`), clamped at 0 | Avoided negative/undercounted kWh between a re-plug and the next tick | Yes |
| D27 | Lad nå and Forvarm with an open plan: Hjem asks "… avbryter planen (klar …). Fortsette?", the Lad nå / Forvarm sheets show the same warning, and only then is the plan cancelled. The server refuses (`cancelPlan` missing) rather than cancelling silently | A waiting plan makes the scheduler pause any charging, so these were stopped again within a minute; the owner asked for an explicit question | Yes |
| D28 | Sessions under 0,1 kWh are left out of Historikk and Innsikt (`MIN_SESSION_KWH`); old rows with no recorded amount stay | Owner: hide the ~0 sessions | Yes |
| D29 | Lending and plans are mutually exclusive: "Lån ut" with an open plan asks and cancels it; `createSchedule` refuses while lent out and `?sheet=plan` shows "Laderen er lånt ut" with "Avslutt utlån". Lad nå, Stopp lading and automatic charging work as usual during lending; "Stopp lading" no longer ends the lending | Owner decision | Yes |
| D30 | Nettleie estimate: energiledd day (weekdays 06–22) and night/weekend rates entered in Innstillinger (from the grid company price list, incl. fees and VAT), energy split by the session's time in each window (`src/lib/pricing.ts`). Kapasitetsledd not included. Empty = energy price only. Applies to Hjem cost, Historikk, Innsikt (with a strøm/nettleie split) and the "Bilen er klar" push | No official nettleie API (NVE stops at 2022, Elhub planned); most grid companies use this day/night-weekend split | Yes |
| D31 | "Bruk" reuses last plan's target % and ready time and works out the kWh from the battery now; no suggestion when the battery is already there; old plans without % keep their kWh | Owner decision | Yes |
| D32 | The app has its own confirm dialog (`ConfirmDialog`, bottom-anchored like the sheets: title, short body, one confirm button — red when it cancels something — and "Ikke nå"); every browser `confirm()` is gone, and the UI tests fail on any native dialog | The browser dialog looked foreign in the PWA; built from the existing tokens, no new design needed | Yes |
| D33 | Unplugged Hjem shows the car's last reading: muted arc and "62 %" with "sist målt i dag 16:41" (was a small "sist 62 %" caption under the plug icon) | Owner asked; follows "honest about freshness". Claude design may refine the layout | Yes |
| D34 | Mock panel "Fullfør plan" adds the plan's remaining kWh and runs a real cron tick, so the end of a plan (final stop, "Bilen er klar" push, ready state) can be seen. The Zaptec session-end webhook doesn't complete plans — it only records energy after unplug | Owner tried session-end to see a finished plan | Yes |
| D35 | The plan accuracy note in Aktivitet ("Ferdig 3 t før klar-tid (som beregnet)") is now Norwegian | It was the last English text shown to the household | Yes |
| D36 | Design update 2026-11-10 (HANDOFF §3, §3b) implemented: dialog anatomy (centred card, tinted icon, two equal buttons, `danger` tokens), the confirm list (Avbryt plan, Stopp lading/forvarming, automatic **on** with duration, Lån ut with "Hvem låner?", Logg ut), "Prøv igjen" dialog for failed charger commands, restyled toasts with "Angre" after Avbryt plan, `noCar` ("Ikke tilkoblet", ca. kWh igjen, unplugged badge, "Batteri i dag") and `ready` ("Bilen er klar", Ferdig … før/etter fristen, check badge, "Siste lading"). Supersedes D32/D33 | Owner asked to implement the updated design | — |
| D37 | Lad nå / Forvarm with an open plan (D27) still ask, in the new dialog style ("Behold" / "Avbryt plan og lad"), although §3b says not to confirm Lad nå | It isn't a plain Lad nå: it cancels a plan, which §3b does confirm | Yes |
| D38 | "Angre" restores the cancelled plan itself (back to pending) instead of creating a copy, within 30 s server-side (toast shows 10 s); refused if the ready time passed or another plan exists. Logged as "Plan gjenopprettet" | Same plan id keeps history tidy; the server window is a little longer than the toast so a slow tap still works | Yes |
| D39 | Logg ut also unsubscribes this device from push, as the dialog promises ("Varsler på denne enheten slås av") | The design copy says so, and a logged-out phone shouldn't keep getting household alerts | Yes |
| D40 | Automatic charging "til i morgen kl. 08:00" is stored as `allow_automatic_charging_until`; the tick switches it off once passed (logged `automatic_disallowed`, automatic sessions closed). Under the quiet tick gate that can be up to 10 min late; the UI already treats it as off | HANDOFF §3b | Yes |
| D41 | "Batteri i dag" counts "−N % siden HH:MM" from the unplug only if the car has reported since; otherwise from the first reading in the window | Found while checking the mock: an unplug after the last reading gave a misleading "siden" time | Yes |
| D42 | The guest name ("Hvem låner?") shows on Hjem ("Lånt ut til …"), in Innstillinger and on the Historikk tag ("Gjest · …") | The field is only useful if it's shown somewhere | Yes |
| D43 | Smart lading (UC16, HANDOFF §6b) built as specified: `on_plugin_mode` (wait/now/smart, with an end time) replaces the automatic-charging boolean; `planSmartCharge` (pure, tested); one `charge_schedules` row with `source = smart` and the blocks per plug-in session, followed by the existing resume/pause loop; re-plan on >5 points SoC drift or >20 % kW error (at most every 10 min); `smartWaiting`/`smartCharging` on Hjem with the night timeline; the "Når bilen kobles til" sheet; `smart_planned` push; "Smart" tag | Design update 2026-11-11 | — |
| D44 | Nettleie defaults are Elvia from 1 Jul 2026 (46,40 / 31,40 øre incl. fees and VAT, night/weekend/holiday split). Kept as the two rate settings from D30 rather than a `grid_tariff` JSON column | The handoff names the grid company and rates; two columns already express the only split Elvia uses | Yes |
| D45 | Norwegian public holidays (Easter-based ones computed) count as night/weekend for the grid rate and use the weekend ready-by time | HANDOFF §6b | — |
| D46 | Smart rows are once per plug-in session: once planned (or cancelled by "Avbryt for i natt", Lad nå, Forvarm, lending or a user plan) the tick won't plan again until the car is unplugged and plugged in | Otherwise cancelling would re-plan a minute later | Yes |
| D47 | Lad nå / Forvarm / lending / a new plan cancel Smart lading without asking (unlike user plans, D27); "Endre for i natt" edits the smart row in the plan sheet and turns it into a user plan | HANDOFF §6b: they "cancel the smart row for that session" | Yes |
| D48 | `charge_schedules.created_by_user_id` is nullable (smart rows belong to nobody); the old `allow_automatic_charging*` columns are migrated into `on_plugin_mode` (0016) and dropped (0017) | Two migrations avoid drizzle-kit's interactive rename; all of 0013–0017 are unapplied anyway | Yes |
| D49 | Choosing "Lad med en gang" or "Smart lading" asks with the duration dialog; changing only the smart target/times keeps the current end time | Matches §3b/§6b; avoids asking again for a small edit | Yes |
| D50 | Review fixes for Smart lading (independent review): plug-in-mode expiry runs before the tick loads open rows, and every status write in the loop only touches still-open rows (no reviving a cancelled plan); a smart row ends only on a real unplug, a different session or Smart lading switched off (not on a one-tick missing session id); one row per session via a partial unique index (0018) and onConflictDoNothing; any plan for the session (finished or cancelled user plan included) blocks Smart lading for that plug-in; Stopp lading cancels Smart lading for the plug-in; switching smart→"Lad med en gang" keeps charging; no resume every minute when the car is released but won't draw (done past ready-by); all off-peak time before any evening-peak hour; re-plan drift measured from the last plan with the clamped energy figure; a new plan cancels Smart lading inside its transaction | Each was a concrete failure path in charger control | — (bug fixes) |
| D51 | "Lad med en gang" and "Smart lading" share one pattern: both pick the target % (70/80/90/100); "Lad med en gang" stops there (automatic session with `target_kwh`, migration 0019, logged "Automatisk lading nådde målet"). No confirm dialog and no "Hvor lenge?" — the choice stays until changed. A guest window still takes precedence over both | Owner decision | Yes |
| D52 | "Navn på stedet" is read-only and follows the Zaptec installation name (synced when it changes); renaming belongs in Zaptec | Owner decision; the app shouldn't diverge from Zaptec | Yes |
| D53 | Stale battery data is normal: planning uses the latest reading of any age (Smartcar, else the last stored webhook reading). With no reading ever, Smart lading plans from empty (ready on time; the car stops when full; the first reading re-plans) and "Lad med en gang" charges until the car stops | Owner: the car just reports rarely; that's not a fault | Yes |
| D54 | Elvia rates verified against Elvia tariffblad 1.0 (standard tariff for forbrukerkunder, valid from 1 Jul 2026): 46,40 / 31,40 øre/kWh incl. Enova, elavgift 7,13 øre and 25 % VAT. "Hvor kommer tallene fra?" in Innstillinger explains the sources, that the fastledd isn't included, and how the day/night split is estimated; Innsikt links to it | Owner asked for the source to be visible | Yes |
| D55 | A plan that's charging can't be edited: no "Endre ›" on the charging plan row, `?sheet=plan` shows "Planen lader nå" with Avbryt plan, and `createSchedule` refuses to replace a plan that is charging. A plan that is waiting (or paused between windows) can still be edited | Owner: keep it simple. Supersedes the Q2 carry-over idea | Yes |
| D56 | The plan sheet always starts at 08:00 (target 80 %); the "Bruk" suggestion keeps last plan's time and % | Owner decision | Yes |
| D57 | Zaptec keeps the session id after a plan's final stop while the car stays plugged in — confirmed in production: plans 473e8caf (done 7 Oct 15:50) and ee5c9ce3 (started 8 Oct 05:15) share session 73692029…, with no unplug until 8 Oct 08:28. The `ready` state and "once per session" rule rely on this | Read-only query of production | — |

## Use-case coverage

| UC | What | Where | Checked |
| --- | --- | --- | --- |
| UC1 | See if the car will be ready | Hjem status line + ring (all 10 states) | unit (homeState), UI test, debug scenarios |
| UC2 | Plan a charge (2 taps with defaults; no car → "Starter når bilen kobles til") | Plan sheet `?sheet=plan` | UI test |
| UC3 | Edit or cancel a plan | Plan sheet prefilled; "Avbryt plan" | UI test |
| UC4 | Follow an active charge | Hjem chargingPlan: ring + sweep, kW, finish time, stats | mock preset "Lader etter plan" |
| UC5 | Lad nå / stopp, also from the push action | Hjem; `?action=charge-now` confirm sheet | UI test |
| UC6 | App can't act | noControl banner; stale heartbeat in header + Innstillinger | mock preset "Laderen krever innlogging" |
| UC7 | Sign in | /login (unchanged flow, Norwegian) | UI test (mock login) |
| UC8 | Preheat | Forvarm button → Forvarm sheet | UI test |
| UC9 | What happened | Historikk → Aktivitet | UI test |
| UC10 | Past charges | Historikk → Økter (week groups, %, kWh, duration, kr) | unit (grouping), UI test |
| UC11 | Energy and cost insights | Innsikt | unit (aggregation), UI test |
| UC12 | Notifications on this device + test | Innstillinger → Varsler | UI (manual); push payloads unit-tested |
| UC13 | Diagnose | Innstillinger → System (+ Mock-kontroll link in mock mode) | manual |
| UC14 | Allow automatic charging | Innstillinger → Lading; tick opens automatic rows | UI test (through the real cron route) |
| UC16 | Smart lading | Innstillinger → Når bilen kobles til; tick plans/follows blocks; Hjem smartWaiting/smartCharging | unit (planner, holidays, decide), UI tests through the real cron route |
| UC15 | Lend the charger | Innstillinger → Lån ut; Hjem guest state | UI test + manual tick walk-through |
