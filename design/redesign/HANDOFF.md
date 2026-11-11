# Lading redesign – implementation handoff

For Claude Code working in `zaptec-smart-charging`. Read `HANDOVER.md` in the repo first; everything there (security model, Zaptec/Smartcar realities, Neon tick gate, the `ship` skill) still applies. This redesign changes the UI and adds a few settings. It does **not** change `decideNextAction` or the free-charging enforcement logic, except where stated below.

Sources of truth:

- **Use-case doc** (Claude Docs, "Zaptec Smart Charging — Use Cases & UX Redesign"): personas, UC1–UC15, decisions, constraints.
- **Mockup canvas** ("Lading – app redesign mockups"): every screen in dark and light mode, the push notifications and the app icon.
- **This folder:** tokens, copy, notification payloads and icon files.

All numbers in the mockups are sample data. The real battery capacity is 46 kWh (`src/lib/vehicle.ts`); the mockups assumed 40.

## Files in this folder

| File | Use | Goes to |
| --- | --- | --- |
| `icon.svg` | Master app icon, 1024², full bleed | `src/app/icon.svg` is the favicon in Next – use `favicon.svg` there instead; keep this as the master |
| `favicon.svg` | Simplified icon for 16–32 px | `src/app/icon.svg` (replace) |
| `favicon.ico` | 16/32/48 ICO | `src/app/favicon.ico` (replace) |
| `apple-icon.png` | 180², opaque | `src/app/apple-icon.png` (replace) |
| `icon-192.png`, `icon-512.png` | PWA icons, purpose `any` | `public/icons/` |
| `icon-maskable-512.png` | PWA icon, purpose `maskable` (art sits inside the 80 % safe zone) | `public/icons/` |
| `badge-96.png`, `badge.svg` | Android notification badge, white on transparent | `public/icons/` |
| `favicon-32.png` | Spare PNG favicon | optional |
| `tokens.json` | Colour, radius, type and size tokens for both themes | reference |
| `theme.css` | The same tokens as CSS variables + Tailwind v4 `@theme` | merge into `src/app/globals.css` |
| `strings.nb.json` | All Norwegian UI copy, incl. activity labels | e.g. `src/lib/i18n/nb.ts` (a typed object is enough; no i18n library needed) |
| `notifications.nb.json` | Push events, triggers and payloads | drives `src/lib/push/` and `public/sw.js` |

## 1. Foundation

1. **Theme:** merge `theme.css` into `globals.css`. Light is the default and dark follows the OS; `<html data-theme>` can force either. Replace hard-coded `black/50`, `white/50`, green/amber/red Tailwind classes with the token utilities (`bg-surface`, `text-muted`, `border-border`, `bg-accent text-on-accent`, …).
2. **Language and formats:** set `<html lang="nb">`. Add helpers in `src/lib/datetime.ts` for:
    - 24h time;
    - "i dag / i morgen / i går";
    - short dates such as "tir. 10. nov.";
    - `formatKw(7.1) → "7,1 kW"`, `formatKwh`, `formatKr(123.4) → "123,40 kr"` via `Intl.NumberFormat("nb-NO")`.
   Always pass `timeZone: HOUSEHOLD_TIME_ZONE`, and never `toLocaleString(undefined)`.
3. **Manifest and metadata:** `name`/`short_name` "Lading". `theme_color` `#0E0F0D`, `background_color` `#0E0F0D`. List the icons:
    - `/icons/icon-192.png` (192×192, any);
    - `/icons/icon-512.png` (512×512, any);
    - `/icons/icon-maskable-512.png` (512×512, maskable).
   In `layout.tsx`, set `viewport.themeColor` to an array with `media` for light `#F3F5EF` and dark `#0E0F0D`. Set the title to "Lading".
4. **Copy:** move every user-facing string to the `nb` object from `strings.nb.json`. `ACTIVITY_LABEL` in `src/lib/activity/log.ts` uses `activity.*`.

## 2. Layout and navigation

- A bottom tab bar on every authenticated page, 84 px tall, four tabs: Hjem `/`, Historikk `/history`, Innsikt `/insights` (new), Innstillinger `/settings` (new). The active tab uses `accent`. Respect `env(safe-area-inset-bottom)`.
- Remove from the header: LogoutButton and NotificationToggle (both move to Innstillinger), and the "View history" link.
- **Header:** greeting (time-of-day) above the location title "Konvallveien 1". Show "Sist sjekket HH:MM" right-aligned with a dot, replacing `SchedulerStatusBadge`; when stale it reads `heartbeat.stale` in amber.
- **Sheets, not pages:** Planlegg/Endre plan and Forvarm open as bottom sheets over Hjem. Route state via `?sheet=plan` / `?sheet=preheat` so push notifications can deep-link. Keep `/schedule/quick` working as a redirect to `/?sheet=plan`.
- **Remove:** `/schedule` (old kWh form), `ScheduleForm`, `QuickScheduleForm` (replaced by the sheet), the old `ChargerCard` layout and the single-page history layout.

## 3. Hjem

One hero card plus one primary action. Derive a `homeState` in a pure, unit-tested function (e.g. `src/lib/ui/homeState.ts`) from charger state, the active schedule, the manual/preheat session, `appHasControl()` and the guest flag:

| homeState | When | Status line | Primary | Secondary |
| --- | --- | --- | --- | --- |
| `noControl` | `!appHasControl()` | Amber banner + "Tilkoblet – venter på innlogging" | none | none |
| `noCar` | Disconnected, no plan | "Ikke tilkoblet" (we don't know where the car is; the % lives only in the ring; falls back to "Ingen bil tilkoblet" without Smartcar) | Planlegg lading | "Koblet fra" card |
| `planWaiting` | Disconnected, pending plan | Plan klar – venter på bilen | Endre plan | Avbryt plan |
| `connected` | Connected, idle, no plan | Tilkoblet – ingen plan | Planlegg lading | Lad nå, Forvarm bilen, one-tap suggestion |
| `planned` | Connected, pending plan | Planlagt – starter ca. HH:MM (amber `tooTight` if `startsImmediately`) | Endre plan | Lad nå, Forvarm bilen |
| `chargingPlan` | Active plan, charging | Lader – ferdig ca. HH:MM | Avbryt plan | plan row "Endre ›" |
| `chargingManual` | Manual session, charging | Lader nå · X kW | Stopp lading | – |
| `preheating` | Preheat session open | Forvarmer – strøm fra laderen | Stopp forvarming | Åpne myOpel |
| `ready` | Plan completed, car still connected, nothing new started | Bilen er klar · "Ferdig 06:50 · 40 min før fristen 07:30" (or "… etter fristen" in amber) | Planlegg lading | Lad nå, Forvarm bilen, "Siste lading" card |
| `smartWaiting` | Connected, no plan, plug-in mode = smart, waiting for the cheap window | Lader i natt HH:MM–HH:MM (+ "Smart lading" pill) | Endre for i natt (opens plan sheet prefilled) | Lad nå, Forvarm bilen, night timeline card |
| `smartCharging` | Smart lading is charging | Lader – ferdig ca. HH:MM (+ pill) | Avbryt for i natt | – |

- **Battery ring (188 px, 12 px stroke):**
    - Arc = battery now, tick = target.
    - While charging, estimate % as Smartcar % + kWh delivered since its `oemUpdatedAt` ÷ capacity, and prefix "ca.".
    - Show "målt HH:MM" when the reading is older than 1 h.
    - No Smartcar: show plan progress in kWh.
    - `noCar`: the car's battery is still shown when it isn't plugged in, because Smartcar reports it regardless of the charger. The ring shows the latest `vehicle_telemetry` / `getStateOfCharge()` reading with "målt HH:MM", plus a small "unplugged" badge on the ring. Below the status line: "ca. N kWh igjen" (% × car capacity). Rule for every state: the battery % appears once, in the ring. Status lines never repeat it. Without any Smartcar reading: dashed track with a plug icon, as before.
    - `ready`: the ring is at the reached %, with the target tick and a lime check badge; "mål nådd" replaces "målt". The "Siste lading" card shows Fra % · Levert kWh · Tid · Kostnad (Norgespris), "Plan av {user}", and a "Detaljer ›" link to the session in Historikk. The state lasts until the car is unplugged (→ `noCar`; the session then appears in Siste hendelser/Historikk) or any new action starts (Planlegg, Lad nå, Forvarm). Derive it from the most recent `completed` schedule for the charger whose `zaptecSessionId` matches the current, still-connected session — no new table needed.
    - "Koblet fra" card (only in `noCar`; replaces "Batteri i dag"):
        - The window always starts at the last unplug. The header shows that moment with a day word: "i dag 07:31", "i går 18:40", "man. 16:40", or a date if older than 6 days. Never a bare HH:MM, which is ambiguous across days.
        - Two figures: **Batteri** change since the unplug ("−18 %"), from the latest reading of any age, and **Kjørt** = odometer now − last odometer reading at or before the unplug ("ca. 41 km").
        - Show "Kjørt" only when the odometer moved by ≥ 1 km and there are readings on both sides of the unplug; otherwise leave the slot out. With sparse readings the figure is rough, hence "ca.".
        - Sparkline of battery % from the unplug to the latest reading, capped to the last 7 days. Dashed lines mark each midnight (labelled "midnatt" when there is one). End labels: "{day word} HH:MM · NN %".
        - Hide the whole card if there is no reading after the unplug.
    - `preheating`: sun icon in amber.
- **Stats row while charging:** Levert (session kWh), Tid, Kostnad (kWh × Norgespris).
- **Siste hendelser:** the last 2 `activity_events`.
- **Suggestion card in `connected`:** the last completed plan's target % and ready-by time projected onto tomorrow. "Bruk" creates the plan directly.

## 3b. Dialogs and toasts

See the "Dialoger og bekreftelser" artboards (dark and light). All copy is in `strings.nb.json` → `dialogs` / `toasts`.

- **Dialog anatomy:** a centred card over the scrim, 20 px radius, 22 px padding. A 40 px tinted icon circle, an 18/600 title phrased as a question, a 15 px muted body that names exactly what changes, and two equal buttons. The safe choice is on the left (outlined); the action is on the right (filled). Use `role="alertdialog"` for destructive confirms, focus the safe button first, and close on Esc or a scrim tap (= safe choice).
- **Destructive action buttons** use new tokens `danger` / `onDanger`: dark `#F87171` / `#1A0505`, light `#B91C1C` / `#FFFFFF`.
- **When to confirm:**
    - Avbryt plan;
    - Stopp lading (manual) and Stopp forvarming;
    - turning **on** "Tillat automatisk lading", with a duration choice: "Til i morgen kl. 08:00" (default) or "Til jeg slår det av";
    - Lån ut laderen, with an optional "Hvem låner?" text field;
    - Logg ut.
  Do **not** confirm saving a plan, Lad nå, or turning automatic charging off.
- **Errors from Zaptec commands:** a dialog with "Prøv igjen" that says nothing else was changed. Validation errors (e.g. overlapping plan) are error toasts, not dialogs.
- **Toasts:** top of the screen, 4 s, built on the existing `sonner`, restyled with the tokens.
    - Success: lime check icon.
    - Undo (after Avbryt plan): an "Angre" action that recreates the cancelled plan within 10 s.
    - Error: a red "!" icon and a red border.
- **New behaviour:** the automatic-charging duration needs `allow_automatic_charging_until` (timestamp, null = indefinitely) in `settings`. The scheduler treats an expired value as off and logs `automatic_disallowed`.

## 4. Plan sheet (create and edit)

- **Batteri nå** slider, prefilled from Smartcar, with the "målt" hint.
- **Lad til** chips 70/80/90/100 (decided: no free slider for now).
- **Klar til:** a day segment (I dag / I morgen / Velg dato) plus time chips 06:30, 07:00, 07:30, 08:00 and Annet. Annet opens hour/minute selects in 5-minute steps; keep the iOS PWA picker workaround from the current form.
- **Live summary** using `estimateChargingPlan()` + the learned kW: "+15,6 kWh · Starter ca. 04:48 · klar 07:30 i morgen".
- **No car connected:** saving is allowed, with the note "Starter når bilen kobles til" (UC2). This already works server-side.
- **Edit:** decided to implement as cancel + create behind one "Lagre plan" button, in a single server action. "Avbryt plan" is a red text button with a confirm.

## 5. Historikk, Innsikt, Innstillinger

- **Historikk** has three segments:
    - **Økter:** sessions grouped by week; each row shows date · time, a tag (Plan / Lad nå / Forvarming / Gjest), % change, kWh, duration and kr.
    - **Planer:** past schedules.
    - **Aktivitet:** the existing feed.
  Sessions the charger started by itself on plug-in and that enforcement stopped are **not** listed as sessions. Show one quiet line per group instead (`history.automaticSummary`); they still appear in Aktivitet. Migrate from deprecated `/api/chargehistory` to `/api/sessions/archived` or `charge_sessions`.
- **Innsikt:**
    - month selector;
    - KPIs: Energi hittil, Kostnad hittil (Norgespris), change vs the same period last month;
    - kWh per day bar chart;
    - Per person: energy goes to `created_by_user_id` for plans and to whoever started manual/preheat sessions; "Gjest" sessions get their own row; automatic sessions are excluded.
  A spot-price comparison comes later, once a price API is chosen.
- **Innstillinger:**
    - Varsler: per-device toggle, plus the iOS home-screen hint.
    - Strømpris: Norgespris price per kWh, stored in settings.
    - Lading: Tillat automatisk lading (UC14), Lån ut laderen (UC15).
    - System: scheduler heartbeat, learned kW, build SHA/env, debug mode toggle (replaces `?debug=1`, but keep the query param working).
    - Konto: name + Logg ut.

## 6. New behaviour (small, but touches the scheduler)

- **UC14 – Lad med en gang (now part of `on_plugin_mode`, see 6b):**
    - A household-wide boolean, default **off**.
    - When on, `enforceAuthorizedCharging()` skips stopping unplanned sessions; they are logged as "Automatisk" and excluded from per-person totals.
    - Log `automatic_allowed` / `automatic_disallowed`.
    - Show a one-line warning under the toggle that anyone at the shared charger can then charge.
- **UC15 – Lån ut laderen:**
    - Opens a guest window that lasts until the next unplug (store it like `manual_charge_sessions`, with `kind = 'guest'`).
    - Enforcement treats it as authorised.
    - The session is tagged Gjest. Smartcar battery and plans are ignored for it, and no notifications are sent.
- **Notifications:** implement `notifications.nb.json`.
    - Extend `PushPayload` with `tag`, `url`, `actions`.
    - In `sw.js`, pass `icon`, `badge`, `tag`, `renotify: false`, `actions` and `data.url`; `notificationclick` opens `event.action`'s url or `data.url`.
    - The two "proposed" events (`plan_late`, `plan_waiting_for_car`) need a once-per-plan flag on `charge_schedules`.
    - Under the Neon tick gate, `plan_waiting_for_car` only fires on full ticks; that's acceptable (≤ 10 min late).

## 6b. Smart lading (UC16) – fully automatic mode

A household setting, `on_plugin_mode`, replaces the old `allow_automatic_charging` boolean. It decides what happens on plug-in when no plan, manual, preheat or guest session applies:

| Value | Behaviour | Notes |
| --- | --- | --- |
| `wait` (default) | Today's enforcement: stop until someone plans or taps Lad nå | |
| `now` | Charge immediately to full; the session is tagged "Automatisk" | Was UC14 |
| `smart` | Charge to `smart_target_percent` by the ready-by time, as cheaply as possible | New |

Switching to `now` or `smart` shows the "anyone at the charger can charge" dialog, with its duration choice (`on_plugin_mode_until`; expiry falls back to `wait`).

**Settings:**

- `smart_target_percent`: 70/80/90/100, default 80.
- `smart_ready_by_weekday`: default 07:30.
- `smart_ready_by_weekend`: default 10:00. Weekend and holiday rules come from the Norwegian public-holiday calendar.

**Planner**, a pure and unit-tested `planSmartCharge(now, socPercent, capacityKwh, learnedKw, readyBy, priceFn)` in `src/lib/scheduler/smart.ts`:

1. Needed kWh = (target − SoC) × capacity. Hours needed = kWh ÷ learned kW (same fallback chain as `estimateChargingPlan`).
2. Build hourly slots from now until readyBy. Each slot's price = energy price + grid energy charge. Norgespris is 50 øre incl. VAT (setting); Elvia energiledd is 31,40 øre at night 22–06, on weekends and on holidays, and 46,40 øre on weekdays 06–22 (from the 1 Jul 2026 tariff sheet).
3. Remove slots in the household evening peak, 16:00–21:00 local time, unless they are needed to reach the target.
4. Pick the cheapest slots. On ties, prefer the latest, so it finishes close to the deadline. Merge them into contiguous blocks.
5. If the slots can't cover the need: use every slot and flag `late` (this feeds the `plan_late` notification).
6. Out of scope for now (decided): spreading the charge at reduced current ("Skån effekttoppen"). It would need the installation's `availableCurrent` via the Zaptec API, unverified on this charger. Revisit later.

**Execution:** on plug-in the tick creates an internal `charge_schedules` row with `source = 'smart'` and the planned blocks (JSON). The existing resume/pause loop then follows the blocks instead of `latestStartTime`. A user plan, Lad nå, Forvarm or guest mode cancels the smart row for that session. Re-plan when SoC changes by more than 5 points, or when the learned kW is off by more than 20 % after the first 10 minutes of charging.

**Prices later:** `priceFn` is an interface. `TariffPriceSource` (Norgespris + Elvia) ships now. A future `SpotPriceSource` (NO1) uses real hourly prices when they are published (around 13:00 for the next day). Otherwise it estimates from the last 4 weeks' average for the same weekday and hour, and the UI labels the cost "anslag".

**UI:**

- Home states `smartWaiting` / `smartCharging`.
- A night timeline with the evening peak (amber), the cheap window (green tint), the charging block, now and readyBy, plus estimated cost and saving vs charging at once.
- Innstillinger → Lading → "Når bilen kobles til" opens a sheet with three radio cards. The smart settings expand under the selected card.

**Notification** `smart_planned`: see `notifications.nb.json`.

**Data:** add these keys to `settings`: `on_plugin_mode`, `on_plugin_mode_until`, `smart_target_percent`, `smart_ready_by_weekday`, `smart_ready_by_weekend`, `grid_tariff` (JSON of periods and prices; seeded with Elvia 2026), `energy_price_nok_per_kwh` (0.50). Add `charge_schedules.source` ('user' | 'smart') and `charge_schedules.blocks` (jsonb, nullable).

## 6c. Driving stats and car attribution (design update 2026-11-12)

Smartcar already reports `Odometer.TraveledDistance`; it is stored in `vehicle_telemetry.odometer_km` by the existing webhook. This adds km, efficiency and cost per distance to Innsikt, and makes it visible which car the stats are counted against.

**Car attribution:**

- Every non-guest session belongs to a car; today that is always the Opel Mokka, the location's default car.
- Resolve the car at read time in `loadSessionRecords`: `row.carId ?? (tag === 'guest' ? null : defaultCar.id)`. Guest sessions have no car and are never mixed into a car's numbers. Automatic and smart sessions count for the default car, because the energy went into it (unless a guest window was open).
- Going forward, store `car_id`:
    - on `charge_schedules`: the column exists; set it on create;
    - on `manual_charge_sessions`: new nullable column, null for `kind = 'guest'`;
    - on `vehicle_telemetry`: new nullable column, filled from the webhook's vehicle id → `cars.smartcar_vehicle_id`.
- **Backfill (owner decision):** one migration sets `car_id` to the default car on every existing `charge_schedules` row, every non-guest `manual_charge_sessions` row and every `vehicle_telemetry` row. Previous sessions are all the Mokka.
- **UI:**
    - Innsikt shows a car chip under the title: "Opel Mokka", with "Gjestelading telles separat". With one car it is a label, not a picker; with several cars it becomes the picker from "Ladere og biler".
    - Historikk rows prefix the detail with the car's short name ("Mokka · 41 → 80 %"); guest rows show "Gjest · {name}".
    - The `ready` "Siste lading" line starts with the car name.

**Kjøring card in Innsikt** (below Per person), for the selected month and car:

| Figure | Definition |
| --- | --- |
| Kjørt (km) | Last odometer reading in the month − last reading before the month (or the first reading in the month if there is none before) |
| Forbruk (kWh/mil) | kWh consumed ÷ km × 10. kWh consumed = sum over consecutive telemetry pairs in the month where the odometer increased and the battery % fell: Δ% × car capacity |
| Effektivitet (km/kWh) | km ÷ kWh consumed (the inverse of the line above) |
| Kostnad (kr/mil) | Forbruk (kWh/mil) × the month's average home cost per kWh (energy + nettleie estimate, same as the Kostnad KPI) |
| Comparison line | The same three figures for the previous month |

**Rules:**

- Use SoC drops, not home-charged kWh, for consumption, because the car may also charge elsewhere. A pair where the battery rose with no home session in between counts as "lading et annet sted": exclude it from consumption, count it in the footnote, and leave it out of cost.
- Readings are sparse (hours apart) and the battery % is an integer, so these are monthly figures only, with no per-trip numbers. Show efficiency/consumption/cost only when the month has ≥ 100 km and ≥ 5 % total SoC drop; otherwise show km only, with "For lite data til å regne forbruk ennå".
- Use "mil" (10 km), the Norwegian convention, for kWh and kr per distance, and km for distance and km/kWh. Format with a decimal comma: 6,1 km/kWh · 1,64 kWh/mil · ca. 2,65 kr/mil.
- Header line: the latest odometer reading and its age ("km-stand 18 342 · målt i går 18:05"), honest about freshness.
- Pure function: `monthDriving(telemetry, homeSessions, month, capacityKwh, avgNokPerKwh)` in `src/lib/ui/driving.ts`, unit-tested with sparse readings, an away charge and a month with no data.

## 7. Data model (prepare for multiple chargers and cars, show nothing extra yet)

- `locations` (id, name, address, zaptec_installation_id). Seed: "Konvallveien 1" from the Zaptec installation address.
- `chargers`: map the Zaptec charger id → location_id, plus a display name.
- `cars` (id, name, battery_capacity_kwh, smartcar_vehicle_id nullable, default_location_id). Seed: Opel Mokka-e, 46 kWh, the current `SMARTCAR_VEHICLE_ID`. Replace `VEHICLE_BATTERY_CAPACITY_KWH` with the car's capacity.
- `charge_schedules.car_id` (nullable, defaults to the location's default car).
- `settings` (key/value or a single row): `allow_automatic_charging`, `energy_price_nok_per_kwh`, `energy_price_model = 'norgespris'`.
- **UI rule:** with one location, one charger and one car, the "Ladere og biler" picker never renders; the address is just the title.

## 8. Suggested order (each step shippable with the `ship` skill)

1. Tokens, `nb` copy, formatters, manifest, icons, `sw.js` icon/badge/tag.
2. Tab bar + header + Hjem with `homeState` (unit tests for every state in the table).
3. Plan sheet (create/edit) + Forvarm sheet; redirect `/schedule/quick`; delete `/schedule`.
4. Historikk segments + automatic-session filtering + archived-sessions migration.
5. Innstillinger (move logout/notifications/debug), Norgespris setting, Innsikt.
6. Notification copy + payload fields; then the two proposed events.
7. UC14 / UC15 + `locations`/`cars`/`settings` tables.

## Acceptance checks

- Every screen meets 4.5:1 text contrast in both themes. Light-mode accent text is `#3F6E1A`, never the lime.
- Touch targets are ≥ 44 px, and there is one filled button per Hjem state.
- No English strings remain in the UI; all times are 24h in Europe/Oslo.
- Debug scenarios (`src/lib/debug/scenarios.ts`) cover every `homeState`, including `preheating` and `planWaiting`.
- Push notifications show the new icon/badge and replace each other per plan (`tag`).
- With automatic charging off (the default), enforcement behaves exactly as today.
