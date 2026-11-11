# Mock mode

Run and click through the whole app locally with **no database, no Zaptec API, no Smartcar, no cron and no web push**. Everything is simulated in memory and resets when the dev server restarts. Nothing is persisted.

```bash
npm run dev:mock      # http://localhost:3100
```

It runs alongside a normal `npm run dev` on :3000. It builds into `.next-mock/` and uses its own session cookie (`mock_session`), so the two don't interfere.

## Logging in

`/login` shows one-click buttons for the seeded users (Roger, Astrid). The seed users' password is in `seed.ts` (`MOCK_PASSWORD`).

## The control panel: `/dev/mock`

Linked from the amber banner at the top of every page.

- **Hopp til en tilstand:** one click to any Hjem state (no car, connected, plan waiting, planned, charging on a plan, Lad nå, preheating, ready, automatic charging allowed, Smart lading — waiting for its night window (planned by a real tick, ready time ~14 h ahead so it works at any hour) or charging in it —, lent to a guest — waiting or charging —, requires login, offline). Each one rebuilds the simulated charger and the open plan and session rows (and switches "Tillat automatisk lading" off unless the preset is about it). **Nullstill alt** goes back to the seed, which includes ~8 weeks of plans, Lad nå, Forvarm, guest sessions and automatic stops for Historikk and Innsikt.
- **Innkommende kall:** fires what normally comes from outside, through the real route handlers and their real auth checks:
  - **Cron tick:** `GET /api/cron/tick` with the bearer secret (what cron-job.org does every minute). There's also an auto-tick every 60 s while the panel is open.
  - **Smartcar webhook:** a signed `VEHICLE_STATE` delivery with the car's current battery.
  - **Zaptec session-end:** the Basic-auth webhook for the last completed session.
  - **Health check:** `GET /api/health` (what UptimeRobot does).
- **Lader og bil:**
  - plug in, unplug, RFID tap
  - "Bilen rapporterer" (refreshes the Smartcar reading)
  - battery slider and +1 kWh
  - "Fullfør plan": adds the plan's remaining energy and runs a tick, to see a plan finish
  - charge power, and speed (×1–×600, so a plan finishes in minutes)
  - "requires login" and "online" switches.
- **Logg:** every simulated charger command, every push notification that would have been sent, and every incoming call.

## UI tests

```bash
npm run test:ui       # Playwright, e2e/redesign.spec.ts
```

Runs the redesign flows (plan sheet, Forvarm, Lad nå push action, plug-in push, Historikk, Innsikt, automatic charging, lending, price) against this mock server, starting it if it isn't running. Uses the installed Microsoft Edge, so there's no browser download. Tests share one in-memory database and run one at a time; the suite resets the mock data first.

## What's simulated, and where

| Real thing | In mock mode | Code |
| --- | --- | --- |
| Postgres (Supabase) | In-memory Postgres (PGlite) built from the real `drizzle/` migrations. Every query runs unchanged. | `db.ts`, `seed.ts`, used by `src/lib/db/index.ts` |
| Zaptec API | `ChargerSim`: free charging auto-starts on plug-in, final stop latches, ResumeCharging can't authorise when auth is required, the car stops at 100 % | `charger.ts`, `zaptec.ts`, used by `src/lib/zaptec/client.ts` |
| Smartcar | The car's last report (stale, like the real one) | `smartcar.ts` |
| Web push | Written to the panel log | `src/lib/push/send.ts` |
| cron-job.org, webhooks, uptime monitor | Panel buttons calling the real route handlers | `actions.ts` |

## Safety

- **Never on Vercel:** `MOCK_MODE` throws on Vercel (`mode.ts`).
- **Fake credentials:** every credential is replaced with a fake value (`src/lib/env.ts`). A code path the mock missed fails, instead of reaching the real database or charger.
- **Real calls blocked:** the real Zaptec and Smartcar HTTP and token calls throw in mock mode (`assertNotMocked`).

## Not covered

- **Clock:** plan deadlines use the real clock. Use a ready-by time a few minutes or hours ahead and a higher speed, rather than time travel.
- **Real push delivery** to a phone: the panel shows the payloads, but nothing reaches the browser's push service.
- **myOpel link:** it still opens the real app or store; it's only a link.
