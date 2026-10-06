# Zaptec Smart Charging

A small household web app for scheduling EV charging on a Zaptec charger: set how much energy to add and when the car should be ready, and a background job starts/stops charging to hit that deadline.

Built as a responsive Next.js app (BFF pattern: the frontend never talks to Zaptec directly) with Postgres for schedules/history, deployed to Vercel.

## How it works

- You (or someone in the household) log in and create a schedule: "charge +20 kWh, ready by 07:00".
- An external cron (cron-job.org, see "Cron job" below) hits `/api/cron/tick` every 5 minutes. It reads each active schedule, checks the charger's live state, and decides whether to send Zaptec's `ResumeCharging` (507) or `StopChargingFinal` (506) command so charging finishes around the deadline rather than immediately.
- If a schedule falls behind, the app prioritizes finishing over the deadline rather than leaving the car undercharged.
- A webhook (`/api/webhooks/zaptec/session-end`) logs completed charging sessions for the history page.

The scheduling decision logic is pure and unit-tested in `src/lib/scheduler/engine.ts` / `engine.test.ts`.

## Known limitations (deliberate v1 scope)

- **No price or solar optimization yet.** v1 is schedule-only, as agreed. Price-based ("cheapest hours") or solar-surplus charging would slot into the same `decideNextAction` function later.
- **Energy, not battery %.** Zaptec doesn't expose vehicle battery state, so "how much to charge" is in kWh delivered this session, not a target percentage. The "Quick schedule" flow converts a target % to kWh itself, using a hardcoded battery capacity for the household car (`VEHICLE_BATTERY_CAPACITY_KWH` in `src/lib/vehicle.ts`) — not anything Zaptec reports.
- **One schedule ≈ one physical charging session.** Progress is tracked via Zaptec's session energy counter, which resets when a new charging session starts (e.g. car unplugged and replugged).
- **Power estimate.** If the charger isn't actively reporting power, the engine assumes 7 kW to estimate how long charging will take. Adjust `DEFAULT_ASSUMED_POWER_KW` in `engine.ts` if your charger's actual rate differs a lot.
- **No pre-charge authorization webhook.** Zaptec also supports a webhook that gates whether a session is allowed to start at all. Its request/response contract isn't publicly documented, and misconfiguring it could block *all* charging — not just scheduled charging — so it's intentionally not implemented. Only the informational session-end webhook is wired up.
- **No self-signup.** Household members are added via a CLI script (`npm run db:add-user`), not a UI, since this is a private family tool.
- **Zaptec API fair-use policy.** Zaptec asks integrators to avoid aggressive polling and to fetch the charger list at most once an hour rather than on every request (see [docs.zaptec.com/docs/api-fair-use-policy](https://docs.zaptec.com/docs/api-fair-use-policy)). The dashboard's `AutoRefresh` interval is 60s (not sub-minute), and `listChargers()` uses Next.js's fetch cache with a 1-hour revalidate instead of fetching fresh every poll. If you add more pollers (e.g. a shorter auto-refresh), keep this policy in mind — the hard rate limit is 10 req/sec/account, well above anything this app does, but the fair-use guidance is about not polling aggressively even under that limit.

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

## Deploying

### 1. Database

Add a Postgres database to the Vercel project (Storage tab → Postgres, which is Neon-backed). Vercel injects `POSTGRES_URL` and friends automatically — set `DATABASE_URL` in the project's environment variables to the pooled connection string it gives you.

### 2. Import the GitHub repo into Vercel

This repo is pushed to GitHub already. In the Vercel dashboard: **Add New → Project → Import Git Repository**, pick this repo, and deploy — no CLI needed. Framework preset (Next.js) is auto-detected.

### 3. Set environment variables

In the Vercel project's **Settings → Environment Variables**, add everything from `.env.example` (Production, and Preview if you want preview deploys to work).

### 4. Run migrations against the production database

From your machine, with `DATABASE_URL` pointed at the production database:

```bash
npm run db:migrate
npm run db:add-user -- you@example.com "Your Name" "a-strong-password"
```

(Repeat `db:add-user` for each household member.)

### 5. Cron job

Vercel Hobby plan caps cron jobs at once/day (and a `vercel.json` declaring anything more frequent will fail to deploy), so this project doesn't use Vercel Cron. GitHub Actions' `schedule` trigger was tried instead, but turned out to be unreliable in practice — GitHub documents it as best-effort and deprioritizes it under load, especially on low-traffic repos; it ended up firing hours apart instead of every 5 minutes.

Instead, [cron-job.org](https://cron-job.org) (free) calls `/api/cron/tick` directly on a real 5-minute schedule:

1. Create a free account at cron-job.org.
2. Create a new cron job:
   - URL: `https://<your-domain>/api/cron/tick`
   - Schedule: every 5 minutes
   - Request method: GET
   - Custom header: `Authorization: Bearer <your CRON_SECRET>` (must match the value set on Vercel)
3. Save and enable it. cron-job.org's dashboard shows execution history/response codes, useful for confirming it's actually running on schedule.

`.github/workflows/scheduler-tick.yml` is kept around as a manual (`workflow_dispatch`-only) way to trigger a tick from the GitHub UI for testing — it no longer runs on a schedule.

If you're on Vercel Pro and would rather use Vercel Cron instead, re-add a `crons` block to `vercel.json` and drop cron-job.org.

### 6. Zaptec Portal webhook (optional, for session history)

In the Zaptec Portal, under the installation's Authentication settings, set the "after session ends" webhook URL to `https://<your-domain>/api/webhooks/zaptec/session-end`, using Basic Auth with the `ZAPTEC_WEBHOOK_USERNAME` / `ZAPTEC_WEBHOOK_PASSWORD` you configured. Do **not** configure the "before authorizing a session" webhook unless you've separately confirmed its payload/response contract — see Known Limitations above.

## Tech stack

- Next.js 16 (App Router, Turbopack, React 19) — note: this project was scaffolded against Next 16, which has real breaking changes vs. earlier versions (e.g. `proxy.ts` instead of `middleware.ts`, fully async `cookies()`/`params`). See `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` if upgrading further.
- Drizzle ORM + Postgres (`postgres` driver), schema in `src/lib/db/schema.ts`.
- Hand-rolled session auth (bcrypt + signed JWT cookie via `jose`) rather than a full auth library — this is a small household login with no social providers or MFA needed, and it avoids pulling in a dependency whose compatibility with bleeding-edge Next 16 / React 19.2 hasn't been proven yet.
- Zaptec API client in `src/lib/zaptec/`, OAuth2 Resource Owner Password flow.
