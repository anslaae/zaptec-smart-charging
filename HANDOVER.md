# Handover: Zaptec Smart Charging

Context for picking this project up in a fresh session with minimal re-exploration. Repo: https://github.com/anslaae/zaptec-smart-charging (private, owner `anslaae`). Local path: `/Users/rogera.slaaen/repo/zaptec-smart-charging`. Live at https://zaptec-smart-charging.vercel.app.

Last substantially updated: 2026-10-14. If this date is old relative to `git log -5`, treat the "Current status" and "Backlog" sections as possibly stale and verify against the code/DB before relying on them.

## What this is

A private household web app for scheduled EV charging on a Zaptec charger, for a Norwegian household (Europe/Oslo). Set "charge +N kWh, ready by HH:MM" and a background job starts/stops charging to hit that deadline. No price/solar optimization (deliberately deferred v2 scope). One charger in practice; the code mostly assumes this (comments call it out where it matters).

Stack: Next.js 16 (App Router, Turbopack) + TypeScript, Postgres (Neon, via Vercel) + Drizzle ORM, hand-rolled signed-cookie session auth (no NextAuth), deployed to Vercel (Hobby plan). BFF pattern — the browser never talks to Zaptec directly. PWA-installable (manifest + icons + Apple meta tags). Push notifications via Web Push (VAPID).

## Current status: live and in daily use

Deployed, migrated, has real household users, and the owner actively uses it to charge a real car. This is **not** a toy/demo — treat production data and the real charger with the same care you'd give any live system. Schema is at migration `0009`; check `drizzle/` for the actual latest before assuming.

## The standing workflow — use the `ship` skill

After almost any code change in this repo, the pattern is: verify (`tsc`, `lint`, `test`, `build`) → commit → push → confirm the Vercel deploy went `Ready`. This has been done dozens of times and has several non-obvious gotchas (a commit-message guardrail false-positive, a GitHub transient-500-eats-the-webhook issue, a reserved shell variable name, etc.). **Use the `ship` skill (`.claude/skills/ship/SKILL.md`) instead of re-deriving this from scratch** — it has the exact commands and the gotchas baked in.

## Architecture map

```
src/lib/env.ts                       zod-validated env vars (VAPID keys and Smartcar vars are optional — see below)
src/lib/db/schema.ts                 Drizzle schema (see table list below)
src/lib/db/index.ts                  Drizzle client (postgres-js)
src/lib/datetime.ts                  Europe/Oslo-aware formatting/parsing helpers (server runs in UTC)
src/lib/vehicle.ts                   hardcoded household car battery capacity, for the %-based "Plan charging" form

src/lib/auth/                        session.ts (jose JWT cookie), password.ts (bcrypt), dal.ts (verifySession/getCurrentUser), actions.ts (login/logout)

src/lib/zaptec/
  constants.ts                      command IDs, observation IDs, ChargerOperationMode enum — see "Zaptec API reality" below
  auth.ts                           OAuth2 ROPC token fetch + in-memory cache
  client.ts                         listChargers, getChargerState, getInstallationRequiresAuth, sendChargerCommand
  state.ts                          PURE helpers: isCurrentlyCharging, isPausedAndResumable, appHasControl, describeOperationMode (no "server-only" import, so it's unit-testable)
  types.ts                          Zaptec API response shapes (PascalCase wire types + camelCase domain types)
  actions.ts                        manual startChargingNow/stopChargingNow server actions

src/lib/scheduler/
  engine.ts                         PURE decideNextAction(schedule, state, now) → resume/pause/complete/none. estimateChargingPlan() shared with the UI's live estimate.
  engine.test.ts                    unit tests for the above
  heartbeat.ts                      STALE_AFTER_SECONDS, shared between the dashboard badge and /api/health
  run.ts                            the cron tick: enforceAuthorizedCharging() (security net), logStateTransitions() (activity log), then per-schedule decide/act loop

src/lib/smartcar/
  auth.ts                           OAuth2 Client Credentials (app-level) token fetch + in-memory cache
  client.ts                        getStateOfCharge() — null if unconfigured or on any failure, see "Smartcar API reality" below
  state.ts                          PURE parseStateOfCharge() (no "server-only" import, so it's unit-testable)
  webhook.ts                        PURE HMAC signature verification + VEHICLE_STATE payload parsing, see api/webhooks/smartcar below
  types.ts, constants.ts           wire response shapes + the signal codes/API base URLs

src/lib/scheduler/accuracy.ts        PURE evaluateScheduleAccuracy() — "did we estimate the charging time well," attached to the PlanCompleted activity log entry in run.ts

src/lib/schedules/actions.ts         createSchedule / cancelSchedule / deleteSchedule server actions
src/lib/activity/log.ts              ActivityType enum + logActivity() — the activity feed shown on /history
src/lib/debug/scenarios.ts           mock ChargerState/schedule fixtures for debug-mode UI previews (never touches real data)
src/lib/push/
  send.ts                           sendPushToAllSubscribers() — web-push, no-ops if VAPID env vars absent
  actions.ts                        subscribeToPush / unsubscribeFromPush server actions

src/app/
  page.tsx                          dashboard: ChargerCard per charger, DebugProvider wrapper, NotificationToggle
  login/page.tsx                    only entry point; no signup UI
  schedule/quick/page.tsx           the "Plan charging" form (QuickScheduleForm, %-based)
  schedule/page.tsx                 older kWh-based form; route kept, link hidden from nav
  history/page.tsx                  Past schedules / Charging activity stats / All sessions / Activity log, all Outlook-style recency-grouped
  api/cron/tick/route.ts            Bearer CRON_SECRET-protected, calls runSchedulerTick()
  api/health/route.ts               PUBLIC (excluded from auth proxy) — build SHA/env, DB reachability, tick staleness, 200/503
  api/webhooks/zaptec/session-end/route.ts   Basic-Auth protected, logs completed sessions
  api/webhooks/smartcar/route.ts   HMAC-signed (SC-Signature), records battery/odometer history — see "Smartcar API reality" below

src/components/                      ChargerCard (the big one — status pills, live summary, Details<collapsible>, actions), ManualChargeButton, DebugProvider (?debug=1 + scenario picker), NotificationToggle, SchedulerStatusBadge, AutoRefresh (pauses when tab hidden), DeleteScheduleButton, various toasts
public/sw.js                         service worker for Web Push (show notification + focus/open on click)
scripts/add-user.mts                 CLI to insert a household user — no signup UI by design
.github/workflows/scheduler-tick.yml manual (workflow_dispatch) only, for testing — NOT the real cron trigger (see below)
```

### DB tables (see `src/lib/db/schema.ts` for the source of truth)

`users`, `charge_schedules` (has `estimated_duration_minutes`, captured once when charging actually starts — see "Smartcar API reality"'s accuracy note), `schedule_actions` (log of commands sent per schedule), `charge_sessions` (from the session-end webhook), `scheduler_heartbeat` (singleton row, last tick time), `charger_observed_state` (singleton-per-charger, last operationMode seen, for diffing), `activity_events` (the human-readable activity feed, optional `user_id`), `manual_charge_sessions` (open-ended "someone manually started this" authorization), `push_subscriptions` (one row per opted-in browser), `webhook_events` (raw webhook payload log, both Zaptec's and Smartcar's), `vehicle_telemetry` (one row per genuinely new battery%/odometer reading from the Smartcar webhook — see below).

## Zaptec API reality (hard-won, verified against the live account — not just docs)

- **Responses are PascalCase**, not camelCase. Raw wire types are mapped to camelCase domain types at the client boundary in `client.ts`/`types.ts`.
- **There is no "start a fresh session" command.** `StartCharging` (command 501) returns `519 UnknownCommand` — it's not usable via the public API at all, despite being a real command ID internally. The only usable pair is `ResumeCharging` (507) and `StopChargingFinal` (506), matching evcc's open-source production Zaptec driver exactly.
- `ResumeCharging` only **undoes a previous `StopChargingFinal`** — sent to a charger that was never explicitly stopped by us, it returns a 528 `DeviceCommandRejected` ("Charging is not Paused nor Scheduled"). This is **treated as success** in `sendChargerCommand()` (harmless, matches evcc's behavior) — but it means it genuinely does nothing if there's nothing to resume.
- **`ChargerOperationMode`: `Disconnected=1, ConnectedRequesting=2, Charging=3, StoppedOrIdle=5`** (no 4). `FinalStopActive` (observation 718) distinguishes "idle, never charged" from "paused, resumable."
- **The installation's "Require authentication" setting gates everything**, and the public API has **no way to toggle it or to authorize a brand-new session** — confirmed by fetching the actual Swagger spec (`api.zaptec.com/swagger/v1/swagger.json`): `/api/installation/{id}/update` only exposes `availableCurrent*` fields, `additionalProperties: false`. With auth required, this app can only pause/resume a session that's *already* authorized (by an RFID tap or the Zaptec app) — it cannot start one from scratch. See the next section for how this household resolved that.
- Full observation/command ID list and reasoning: `src/lib/zaptec/constants.ts` comments. Re-verify against the live `/api/constants` endpoint if something doesn't match (that's the ground truth, not the public docs site, which has been found stale before).
- Zaptec's own **native Eco Mode** is an installation-level feature flag (`EnabledFeatures` bitmask, bit 8), separate from anything charger-level — it's off for this household (confirmed, was a real source of a bug early on when it silently conflicted with manual commands).
- The `/api/chargehistory` endpoint is Zaptec-deprecated (phase-out from 2026-08-01) in favor of `/api/sessions/archived` — not yet migrated in this codebase; check if it still works before assuming it does.
- Fair-use policy: avoid aggressive polling. `listChargers()`/`getInstallationRequiresAuth()` are cached (1h / 5min via Next's fetch cache); `AutoRefresh` on the dashboard is 60s, not sub-minute; `/api/health` deliberately does **not** check Zaptec connectivity, to avoid adding uptime-monitor-driven load.

## Smartcar API reality (car battery/odometer)

Shows the connected car's traction battery % on the dashboard (`src/lib/smartcar/`) and records battery/odometer history for the `/history` charts, entirely separate from the Zaptec integration — read-only, optional, and never on the critical path (every call/write path returns `null`/no-ops rather than throwing if unconfigured or if anything goes wrong).

- **Deliberately not using the official `smartcar/node-sdk`.** It's in maintenance mode, unsupported after 2026-12-01, and built around the **v2.0** Vehicles API (per-vehicle OAuth, `exchangeCode`/`exchangeRefreshToken`) — which sunsets the same day. Direct HTTP calls against the current **v3** API, same approach this codebase already takes for Zaptec.
- **v3 auth is app-level, not per-vehicle.** One OAuth2 Client Credentials token (`POST https://iam.smartcar.com/oauth2/token`, 1h validity, no refresh token — just re-fetch) authenticates every GET request; `src/lib/smartcar/auth.ts` caches it the same way `zaptec/auth.ts` does. Every vehicle/signal GET additionally needs an `sc-user-id` header — the permanent identifier Smartcar assigned when the car was connected via Smartcar Connect (obtained once, not an expiring token; see `GET /v3/connections?filter[vehicleId]=...` if it's ever lost).
- **GET does not make Smartcar re-poll the vehicle — confirmed empirically, not just from docs.** Re-querying the same signal ~2.5h apart returned a byte-identical response, including `retrievedAt`/`ingestedAt` (Smartcar's own docs: those are when *Smartcar* last retrieved the data, not when we called the API). A GET just reads Smartcar's last-cached snapshot; only an active webhook subscription makes Smartcar actually monitor the vehicle and refresh it. **This is why there's both a GET-based path (`client.ts`, for the dashboard's on-demand display) and a webhook (`api/webhooks/smartcar/route.ts`, for `vehicle_telemetry` history)** — an earlier version of this doc said "no webhooks" based on the display-only use case; that reasoning doesn't hold once you need a real time series.
- **The webhook**: HMAC-SHA256 verified via `SC-Signature` (raw body, before JSON parsing) using `SMARTCAR_APPLICATION_MANAGEMENT_TOKEN` — a separate credential from the client ID/secret, from the Smartcar Dashboard. Handles the one-time `VERIFY` handshake (HMAC of the challenge itself) and ongoing `VEHICLE_STATE` deliveries. Configured in the Smartcar Dashboard with triggers **and** data-payload signals set to `TractionBattery.StateOfCharge` + `Odometer.TraveledDistance` (both, so every delivery carries both values). **Scalable by construction, not by cadence**: a new `vehicle_telemetry` row is only inserted when at least one signal's `oemUpdatedAt` actually changed vs. the last stored row (also gives free idempotency against Smartcar's at-least-once redelivery) — rows don't grow with delivery/retry volume, only with real OEM updates.
- **OEM data is noticeably stale.** Observed `oemUpdatedAt` several hours behind `retrievedAt`/delivery time on this Opel Mokka (Stellantis apparently doesn't push updates to Smartcar often) — the dashboard always shows "as of HH:MM" alongside the percentage rather than implying it's live. This is also why the live reading isn't (yet) used to prefill `QuickScheduleForm`'s "Battery now" slider — a stale value could be wrong mid- or post-charge; flagged as a possible follow-up, not done.
- Required scopes in the Smartcar Dashboard's Vehicle Access config: `read_battery`, `read_odometer` (both already granted on this connection — confirmed live, no reconnect was needed).
- **Planned-charge estimate accuracy** (not a Smartcar feature, but lives alongside it conceptually): `charge_schedules.estimated_duration_minutes` is captured once, the moment charging actually starts, from `estimateChargingPlan()`'s `remainingKwh`/`powerKw` at that instant. When the plan completes, `src/lib/scheduler/accuracy.ts` compares that prediction against the real duration and the ready-by deadline, and the result becomes the `detail` on the `PlanCompleted` activity log entry (visible on `/history`'s Activity section). Deliberately *not* comparing actual-vs-predicted start time — `decideNextAction` only resumes once `now >= latestStartTime`, so that comparison is circular (always ~0).
- Env vars: `SMARTCAR_CLIENT_ID`, `SMARTCAR_CLIENT_SECRET`, `SMARTCAR_VEHICLE_ID`, `SMARTCAR_USER_ID`, `SMARTCAR_APPLICATION_MANAGEMENT_TOKEN` — all optional in `env.ts`, same "silently no-op if unset" pattern as the VAPID keys.

## The security model: free charging + software enforcement

This is the single biggest architectural decision in the app, made deliberately after investigating alternatives — **don't re-litigate it without re-reading this section**.

The charger sits in a public/shared area, so "Require authentication" should stay on for security. But (per above) that makes the app's own automation impossible — it can't authorize a fresh session. The chosen trade-off: **the installation runs with "Require authentication" OFF (free charging)**, so anyone plugging in auto-starts a session, and the app compensates entirely in software:

- Every scheduler tick (`enforceAuthorizedCharging()` in `run.ts`) checks **every** charger, not just ones with a schedule: if it's drawing power with no active schedule and no open `manual_charge_sessions` row, it gets `StopChargingFinal`'d immediately. `StopChargingFinal` latches (`FinalStopActive`), so it won't silently resume.
- Manual "Charge now" opens a `manual_charge_sessions` row (closed on "Stop charging" or on disconnect) so the enforcement doesn't immediately kill a legitimate manual session.
- This is **poll-based**, not instant — an unrecognized plug-in can draw power for up to one cron interval (currently 1 minute) before it's cut. That gap is the known, accepted cost of this approach.
- A per-charger "App not in control" badge (`appHasControl()` in `state.ts`) shows if "Require authentication" ever gets switched back on and there's no existing session to manage — manual/plan controls are hidden in that state rather than silently doing nothing.

**The "correct" alternative is OCPP** (switch the installation to OCPP mode, run our own CSMS that issues real `RemoteStartTransaction`/authorizes at the protocol level) — this was explained in detail to the user and **explicitly deferred**: it needs a new always-on server (can't run on Vercel's serverless functions — OCPP needs a persistent inbound WebSocket), a nontrivial OCPP 1.6 implementation, and probably loses some native Zaptec app convenience. Don't build this unprompted; it's a deliberate future project, not a bug to fix.

## Activity log, not alarms

`activity_events` records both physical transitions (plugged in/unplugged, charging started/stopped — diffed from `charger_observed_state`) and app actions (manual start/stop, plan created/cancelled/completed, the enforcement stopping an unplanned session). **The tone is deliberately neutral/log-like, not an alert banner** — plugging in with no plan ready and getting auto-stopped shortly after is the *normal* case under free charging, not a security incident. An earlier version had a dashboard warning banner for this; it was removed for being too dramatic. Don't re-add dashboard alerting for this specific event without being asked.

## Debug mode and observability

- **`?debug=1`** on the dashboard (persisted via localStorage, `?debug=0` to turn off) shows a bar with the exact deployed build's short git SHA + Vercel env, plus a dropdown to preview every dashboard state (no car, charging, plan pending, app-not-in-control, etc.) using pure front-end mock data (`src/lib/debug/scenarios.ts`) — real action buttons are disabled during a preview so a click can't send a real command based on fake state. This exists because of a real incident where the user saw stale UI and we needed a way to prove, concretely, which deployment they were actually looking at (it turned out to be real staleness, resolved by a hard refresh — the SHA check is what proved it).
- **`GET /api/health`** is public (excluded from the auth proxy), returns `{status, sha, env, time, database: {ok}, scheduler: {lastTickAt, secondsSinceLastTick, stale}}`, `200` when healthy / `503` otherwise. UptimeRobot is configured against it (user's own external account, not something this repo manages).

## Push notifications

Opt-in per browser/device (toggle in the dashboard header, off by default — no app-wide switch). Fires for exactly three things: car connected, a planned charge starting (first resume of a schedule), a planned charge finishing (target energy reached). **Manual start/stop never notifies** — the person doing it already knows. Needs `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`NEXT_PUBLIC_VAPID_PUBLIC_KEY` set (optional in `env.ts` — absent, it silently no-ops rather than crashing the app); these are already set in Vercel as of 2026-10-08. On iPhone this only works for the PWA installed to the home screen, not a regular Safari tab — an Apple platform restriction, not fixable from here.

## Sandbox/tooling gotchas (this environment specifically, not the app)

- **A commit-message guardrail hook** (`/usr/local/share/catalystone-baseline/guardrail-check.sh`, org-wide CatalystOne policy) occasionally **false-positive blocks `git commit`** when the message body happens to contain certain phrases (observed: "now matches", "now fetched", "now split", "now rejects", "now uses", bare "now"). It also **correctly** blocks literal `vercel --prod`/`vercel deploy` commands (that one's not a false positive — deploying is meant to go through `git push` triggering Vercel's own GitHub integration, never the CLI directly). Recovery for the message false-positive: reword and retry; never use `--no-verify`.
- **`vercel env add` is blocked** (secret-store-writes classifier) — the user has to add/update Vercel env vars themselves, via the dashboard or their own CLI session.
- Writing a **freshly-generated** secret (session secret, VAPID keypair, etc.) to `.env.local` via Edit/Write works fine. Writing an **existing real secret fetched from an external provider** can get silently scrubbed to `"[SENSITIVE]"` by a credential-materialization classifier — if `.env.local` ever shows that literal string where a real value should be, that's what happened; have the user paste the real value themselves.
- The shell variable name `status` is reserved/read-only in this zsh environment — use `dep_status` or similar in deploy-polling loops (also baked into the `ship` skill).
- GitHub's push endpoint has had at least one transient outage (`Internal Server Error` on push, repeatable for several minutes) that also seems to eat the push→Vercel-webhook delivery even after the push itself later succeeds — if a deploy doesn't appear in `vercel ls` within ~30s of a successful push, an empty `git commit --allow-empty` + push re-triggers it reliably.
- `git add` on a command line that includes `.env.local` by name gets blocked by the auto-mode data-exfiltration classifier even though the file is gitignored and the add would've been a no-op — just don't pass it explicitly to `git add`.

## Backlog (GitHub issues)

- **#1 Push notifications** — core sending shipped; **per-user, per-event-type configurability** still open (today it's one all-or-nothing toggle per device).
- **#2 Biometric login (WebAuthn/passkeys)** — not started. Explicitly additive to the existing password login, never a replacement.
- **OCPP migration** — deliberately deferred, see above. Not a GitHub issue (it's a bigger discussion than a single backlog item); re-read the "security model" section above before proposing it again.

## Where the original Zaptec API knowledge came from

`docs.zaptec.com` (overview/reference pages) for the initial build, but several specific facts in this document were since **corrected against the live account and the actual `/api/constants` and Swagger spec** after the docs turned out to be incomplete or stale in places (notably: the StartCharging/519 behavior, and the full extent of what the installation-update endpoint exposes). Prefer live verification over the docs site if the two disagree.
