# Zaptec Smart Charging

A small household web app for scheduling EV charging on a Zaptec charger: set how much energy to add and when the car should be ready, and a background job starts/stops charging to hit that deadline.

Built as a responsive Next.js app (BFF pattern: the frontend never talks to Zaptec directly) with Postgres for schedules/history, deployed to Vercel.

## How it works

- You (or someone in the household) log in and create a schedule: "charge +20 kWh, ready by 07:00".
- An external cron (cron-job.org, see "Cron job" below) hits `/api/cron/tick` every minute. It reads each active schedule, checks the charger's live state, and decides whether to send Zaptec's `ResumeCharging` (507) or `StopChargingFinal` (506) command so charging finishes around the deadline rather than immediately.
- If a schedule falls behind, the app prioritizes finishing over the deadline rather than leaving the car undercharged.
- The same tick also checks every charger for charging with no active schedule and no manual-start authorization behind it, and stops it (see "Require authentication vs. free charging" below).
- Every plug-in, charging start/stop, manual action, and plan created/cancelled/completed is logged to a plain activity feed (`activity_events` table, shown on the history page) -- plugging in with no plan ready and immediately being auto-stopped is the expected normal case, not an alarm.
- The dashboard shows a per-charger "App not in control" badge (from `appHasControl()` in `src/lib/zaptec/state.ts`) whenever Require authentication is back on and there's no existing session to manage -- manual start/stop and planning are hidden in that state since they wouldn't do anything.
- A webhook (`/api/webhooks/zaptec/session-end`) logs completed charging sessions for the history page.

The scheduling decision logic is pure and unit-tested in `src/lib/scheduler/engine.ts` / `engine.test.ts`.

## Known limitations (deliberate v1 scope)

- **No price or solar optimization yet.** v1 is schedule-only, as agreed. Price-based ("cheapest hours") or solar-surplus charging would slot into the same `decideNextAction` function later.
- **Energy, not battery %, from Zaptec's own side.** Zaptec doesn't expose vehicle battery state, so "how much to charge" is in kWh delivered this session, not a target percentage. The "Quick schedule" flow converts a target % to kWh itself, using a hardcoded battery capacity for the household car (`VEHICLE_BATTERY_CAPACITY_KWH` in `src/lib/vehicle.ts`) — not anything Zaptec reports. If Smartcar is configured (see below), the form's starting-% slider is prefilled from the car's actual reported battery level instead of a blind guess — still just a default, since that reading can be several hours stale.
- **Optional Smartcar integration** (`src/lib/smartcar/`) shows the connected car's battery % and odometer on the dashboard and `/history`, and records history over time via a Smartcar webhook — entirely separate from the Zaptec integration, and the app works fine with none of it configured. See `HANDOVER.md`'s "Smartcar API reality" section for the full picture (why there's no SDK, the v3 auth model, why a webhook rather than polling) and "Environment variables"/"Deploying" below for setup.
- **One schedule ≈ one physical charging session.** Progress is tracked via Zaptec's session energy counter, which resets when a new charging session starts (e.g. car unplugged and replugged).
- **Power estimate.** If the charger isn't actively reporting power, the engine assumes 7 kW to estimate how long charging will take. Adjust `DEFAULT_ASSUMED_POWER_KW` in `engine.ts` if your charger's actual rate differs a lot.
- **No pre-charge authorization webhook.** Zaptec also supports a webhook that gates whether a session is allowed to start at all. Its request/response contract isn't publicly documented, and misconfiguring it could block *all* charging — not just scheduled charging — so it's intentionally not implemented. Only the informational session-end webhook is wired up.
- **No self-signup.** Household members are added via a CLI script (`npm run db:add-user`), not a UI, since this is a private family tool.
- **Zaptec API fair-use policy.** Zaptec asks integrators to avoid aggressive polling and to fetch the charger list at most once an hour rather than on every request (see [docs.zaptec.com/docs/api-fair-use-policy](https://docs.zaptec.com/docs/api-fair-use-policy)). The dashboard's `AutoRefresh` interval is 60s (not sub-minute), and `listChargers()` uses Next.js's fetch cache with a 1-hour revalidate instead of fetching fresh every poll. If you add more pollers (e.g. a shorter auto-refresh), keep this policy in mind — the hard rate limit is 10 req/sec/account, well above anything this app does, but the fair-use guidance is about not polling aggressively even under that limit.
- **Require authentication vs. free charging.** Zaptec's public partner API has no command to authorize a brand-new session (only `ResumeCharging`/`StopChargingFinal`, which only resume/pause a session already underway) and no way to toggle the installation's "Require authentication" setting remotely — confirmed against the full Swagger spec at `api.zaptec.com/swagger/v1/swagger.json`. With authentication required, neither manual nor scheduled starts can work at all: the charger just sits waiting for an RFID tap. This installation therefore runs with "Require authentication" off (free charging) so the app can actually control it, and `enforceAuthorizedCharging()` in `src/lib/scheduler/run.ts` compensates in software: every tick, any charger drawing power with no active schedule and no open manual-start authorization gets `StopChargingFinal`'d. This is poll-based (currently every minute), so an unrecognized plug-in can draw power for up to that long before it's cut — a real OCPP integration (switching the installation to OCPP mode and running a CSMS that issues `RemoteStartTransaction`) would close that gap properly, but needs a persistent WebSocket connection that doesn't fit this app's serverless Vercel deployment, so it's left as a future option.

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in the values, see below
npm run db:generate          # only needed if you change src/lib/db/schema.ts
npm run db:migrate           # applies drizzle/*.sql to your database
npm run db:add-user -- you@example.com "Your Name" "a-strong-password"
npm test                     # scheduler engine unit tests
npm run dev
```

### Environment variables

See `.env.example` for the full list and how to generate each secret. You'll need:

- `DATABASE_URL` — any Postgres instance for local dev.
- `SESSION_SECRET` — signs the login session cookie.
- `ZAPTEC_USERNAME` / `ZAPTEC_PASSWORD` — your Zaptec account, used server-side only, to call the Zaptec API on your app's behalf. This account needs owner/service access to the charger(s).
- `CRON_SECRET` — shared secret the cron job must present; checked in `/api/cron/tick`.
- `ZAPTEC_WEBHOOK_USERNAME` / `ZAPTEC_WEBHOOK_PASSWORD` — pick any values; you'll enter the same ones in the Zaptec Portal when configuring the webhook.
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — optional, for push notifications (see "Push notifications" below). Without them the app runs fine; notifications just silently don't send.
- `SMARTCAR_CLIENT_ID` / `SMARTCAR_CLIENT_SECRET` / `SMARTCAR_VEHICLE_ID` / `SMARTCAR_USER_ID` / `SMARTCAR_APPLICATION_MANAGEMENT_TOKEN` — optional, for the Smartcar integration (battery %, odometer, see "Smartcar (optional)" below). Without them the app runs fine; the dashboard just omits the battery reading and `/history`'s "Vehicle" section stays empty.

## Deploying

### 1. Database

Production runs on [Supabase](https://supabase.com) Postgres (free tier). Create a project, then in the Supabase dashboard open **Connect** and copy the **Session pooler** connection string (`postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`). Use the session pooler (port 5432) rather than the transaction pooler (6543, which breaks `postgres-js`'s prepared statements) or the direct connection (IPv6-only, which Vercel functions can't reach). Set it as `DATABASE_URL` in Vercel and in your `.env.local`. The app only talks to Postgres directly, so Supabase's Data API (PostgREST) isn't needed and can be turned off.

### 2. Import the GitHub repo into Vercel

This repo is pushed to GitHub already. In the Vercel dashboard: **Add New → Project → Import Git Repository**, pick this repo, and deploy — no CLI needed. Framework preset (Next.js) is auto-detected.

### 3. Set environment variables

In the Vercel project's **Settings → Environment Variables**, add everything from `.env.example` (Production, and Preview if you want preview deploys to work).

### 4. Run migrations against the production database

From your machine, with `.env.local`'s `DATABASE_URL` pointed at the production (Supabase session pooler) database — `npm run db:migrate` applies any new `drizzle/*.sql` migrations:

```bash
npm run db:migrate
npm run db:add-user -- you@example.com "Your Name" "a-strong-password"
```

(Repeat `db:add-user` for each household member.)

### 5. Cron job

Vercel Hobby plan caps cron jobs at once/day (and a `vercel.json` declaring anything more frequent will fail to deploy), so this project doesn't use Vercel Cron. GitHub Actions' `schedule` trigger was tried instead, but turned out to be unreliable in practice — GitHub documents it as best-effort and deprioritizes it under load, especially on low-traffic repos; it ended up firing hours apart instead of every 5 minutes.

Instead, [cron-job.org](https://cron-job.org) (free) calls `/api/cron/tick` directly on a real minute-by-minute schedule:

1. Create a free account at cron-job.org.
2. Create a new cron job:
   - URL: `https://<your-domain>/api/cron/tick`
   - Schedule: every minute
   - Request method: GET
   - Custom header: `Authorization: Bearer <your CRON_SECRET>` (must match the value set on Vercel)
3. Save and enable it. cron-job.org's dashboard shows execution history/response codes, useful for confirming it's actually running on schedule.

`.github/workflows/scheduler-tick.yml` is kept around as a manual (`workflow_dispatch`-only) way to trigger a tick from the GitHub UI for testing — it no longer runs on a schedule.

If you're on Vercel Pro and would rather use Vercel Cron instead, re-add a `crons` block to `vercel.json` and drop cron-job.org.

### 6. Zaptec Portal webhook (optional, for session history)

In the Zaptec Portal, under the installation's Authentication settings, set the "after session ends" webhook URL to `https://<your-domain>/api/webhooks/zaptec/session-end`, using Basic Auth with the `ZAPTEC_WEBHOOK_USERNAME` / `ZAPTEC_WEBHOOK_PASSWORD` you configured. Do **not** configure the "before authorizing a session" webhook unless you've separately confirmed its payload/response contract — see Known Limitations above.

### 7. Health check (optional, for uptime monitoring)

`GET /api/health` is public (excluded from the auth proxy) and returns plain JSON with the right HTTP status for an uptime monitor to alert on:

```json
{
  "status": "ok",
  "sha": "41f45c5",
  "env": "production",
  "time": "2026-10-08T20:30:00.000Z",
  "database": { "ok": true },
  "scheduler": { "lastTickAt": "2026-10-08T20:29:12.000Z", "secondsSinceLastTick": 48, "stale": false }
}
```

Returns `200` when the database is reachable and the scheduler tick isn't stale (same threshold as the dashboard's badge), `503` otherwise. It deliberately doesn't check Zaptec API connectivity, to avoid adding uptime-monitor-driven polling on top of what the app already does. The `sha`/`env` fields are also how the dashboard's own debug mode (`?debug=1`) shows which deployment is actually running.

### 8. Push notifications (optional)

Each household member can turn on browser push notifications from the "Enable notifications" link in the dashboard header -- off by default, and purely a per-browser/device opt-in (there's no app-wide switch). Notified events are deliberately narrow: a car getting plugged in, a planned charge starting, and a planned charge finishing. Manual start/stop never notifies, since the person doing it already knows.

To enable it:

1. Generate a VAPID keypair: `node -e "console.log(require('web-push').generateVAPIDKeys())"`.
2. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (same value as `VAPID_PUBLIC_KEY`) in Vercel's environment variables.
3. Redeploy. No webhook or external service needed -- `src/lib/push/send.ts` sends directly from the scheduler tick via the `web-push` package, straight to each browser's own push service (Apple/Google), which is why it works even when the app is closed. On iPhone this only works for the PWA installed to the home screen, matching Apple's general Web Push restriction, not something this app can work around.

### 9. Smartcar (optional, for battery %/odometer)

1. Create a Smartcar Developer account and app at [dashboard.smartcar.com](https://dashboard.smartcar.com), and run its Connect flow once to link the household car — this gives you the vehicle ID and the `userId` (returned on the Connect redirect, or via `GET /v3/connections`).
2. In the Dashboard's **Vehicle Access** config, enable the `read_battery` and `read_odometer` signals/permissions.
3. Set `SMARTCAR_CLIENT_ID`, `SMARTCAR_CLIENT_SECRET` (API Credentials tab), `SMARTCAR_VEHICLE_ID`, and `SMARTCAR_USER_ID` in Vercel, and deploy.
4. For battery/odometer **history** (the `/history` page's "Vehicle" charts): find the **Application Management Token** in the Dashboard, set it as `SMARTCAR_APPLICATION_MANAGEMENT_TOKEN` in Vercel, and redeploy. Then create a webhook in the Dashboard pointed at `https://<your-domain>/api/webhooks/smartcar`, with both triggers **and** data-payload signals set to `TractionBattery.StateOfCharge` and `Odometer.TraveledDistance`, subscribe the vehicle to it, and click "Verify this webhook" (the endpoint must already be deployed and live for this handshake to succeed).

See `HANDOVER.md`'s "Smartcar API reality" section for why this needs a webhook at all (a plain GET doesn't make Smartcar re-poll the vehicle) and the reasoning behind every other design choice here.

## Tech stack

- Next.js 16 (App Router, Turbopack, React 19) — note: this project was scaffolded against Next 16, which has real breaking changes vs. earlier versions (e.g. `proxy.ts` instead of `middleware.ts`, fully async `cookies()`/`params`). See `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` if upgrading further.
- Drizzle ORM + Postgres (`postgres` driver), schema in `src/lib/db/schema.ts`.
- Hand-rolled session auth (bcrypt + signed JWT cookie via `jose`) rather than a full auth library — this is a small household login with no social providers or MFA needed, and it avoids pulling in a dependency whose compatibility with bleeding-edge Next 16 / React 19.2 hasn't been proven yet.
- Zaptec API client in `src/lib/zaptec/`, OAuth2 Resource Owner Password flow.
