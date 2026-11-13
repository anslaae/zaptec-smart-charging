import bcrypt from "bcryptjs";
import { MOCK_CHARGER } from "./mode";

// Seed data for the in-memory mock database: two household users and a few
// days of plausible history so Historikk/Hjem have something to show.
//
// Mock login: both users' password is MOCK_PASSWORD (also used by the
// one-click buttons on /login in mock mode). Test-only values -- this
// database lives in memory and only exists in `npm run dev:mock`.
export const MOCK_PASSWORD = "mock";

export const MOCK_USERS = [
  { id: "00000000-0000-4000-8000-0000000000a1", email: "roger@mock.local", name: "Roger" },
  { id: "00000000-0000-4000-8000-0000000000a2", email: "astrid@mock.local", name: "Astrid" },
] as const;

const q = (value: string | null) => (value == null ? "NULL" : `'${value.replace(/'/g, "''")}'`);
const ts = (date: Date) => q(date.toISOString());

/** Plain SQL (run in the same exec as the schema, so queries queue behind it). */
export function seedSql(now: Date): string {
  const hash = bcrypt.hashSync(MOCK_PASSWORD, 10);
  const day = 24 * 60 * 60 * 1000;
  const c = MOCK_CHARGER;
  const [roger, astrid] = MOCK_USERS;

  // Two completed plans on earlier nights (the latest one feeds the Hjem suggestion).
  const plans = [
    { id: "00000000-0000-4000-8000-0000000000d1", by: astrid.id, kwh: "13.80", readyBy: new Date(now.getTime() - 2 * day), session: "00000000-0000-4000-9000-000000000001" },
    { id: "00000000-0000-4000-8000-0000000000d2", by: roger.id, kwh: "15.60", readyBy: new Date(now.getTime() - 1 * day), session: "00000000-0000-4000-9000-000000000002" },
  ];
  // Put both ready-by times at 07:30 Oslo-ish (06:30 UTC in winter) for a realistic suggestion.
  for (const p of plans) p.readyBy.setUTCHours(6, 30, 0, 0);

  const planRows = plans
    .map((p) => {
      const started = new Date(p.readyBy.getTime() - 3 * 60 * 60 * 1000);
      const ended = new Date(p.readyBy.getTime() - 20 * 60 * 1000);
      return `(${q(p.id)}, ${q(p.by)}, ${q(c.id)}, ${q(c.name)}, ${p.kwh}, ${ts(p.readyBy)}, 'completed', 'stop', 'Target energy reached', ${ts(ended)}, ${ts(new Date(p.readyBy.getTime() - 12 * 60 * 60 * 1000))}, ${ts(ended)}, ${ts(started)}, ${ts(ended)}, ${q(p.session)}, 160, ${p.kwh}, 46, 80)`;
    })
    .join(",\n  ");

  const events: [string, string, string | null, string | null, Date][] = [
    ["plan_created", astrid.id, "13,8 kWh, klar", null, new Date(plans[0].readyBy.getTime() - 12 * 60 * 60 * 1000)],
    ["plan_completed", "", null, null, new Date(plans[0].readyBy.getTime() - 20 * 60 * 1000)],
    ["unplugged", "", null, null, new Date(plans[0].readyBy.getTime() + 60 * 60 * 1000)],
    ["plugged_in", "", null, null, new Date(plans[1].readyBy.getTime() - 14 * 60 * 60 * 1000)],
    ["stopped_unplanned", "", null, null, new Date(plans[1].readyBy.getTime() - 14 * 60 * 60 * 1000 + 60 * 1000)],
    ["plan_created", roger.id, "15,6 kWh, klar", null, new Date(plans[1].readyBy.getTime() - 12 * 60 * 60 * 1000)],
    ["plan_completed", "", null, null, new Date(plans[1].readyBy.getTime() - 20 * 60 * 1000)],
    ["unplugged", "", null, null, new Date(plans[1].readyBy.getTime() + 60 * 60 * 1000)],
  ];
  const eventRows = events
    .map(
      ([type, userId, detail, , at]) =>
        `(${q(c.id)}, ${q(c.name)}, ${q(type)}, ${q(detail)}, ${ts(at)}, ${userId ? q(userId) : "NULL"})`,
    )
    .join(",\n  ");

  const history = historySql(now);

  return `
INSERT INTO users (id, email, password_hash, name) VALUES
  (${q(roger.id)}, ${q(roger.email)}, ${q(hash)}, ${q(roger.name)}),
  (${q(astrid.id)}, ${q(astrid.email)}, ${q(hash)}, ${q(astrid.name)});

INSERT INTO charge_schedules (id, created_by_user_id, charger_id, charger_name, target_energy_kwh, ready_by, status,
  last_command, last_note, last_evaluated_at, created_at, updated_at, started_at, ended_at, zaptec_session_id,
  estimated_duration_minutes, remaining_kwh_at_start, start_percent, target_percent) VALUES
  ${planRows};

INSERT INTO activity_events (charger_id, charger_name, type, detail, created_at, user_id) VALUES
  ${eventRows};

INSERT INTO scheduler_heartbeat (id, last_tick_at) VALUES ('singleton', ${ts(new Date(now.getTime() - 30 * 1000))});
INSERT INTO charger_observed_state (charger_id, operation_mode, updated_at) VALUES (${q(c.id)}, 1, ${ts(now)});
${history}
`;
}

// ~8 weeks of older sessions for Historikk and Innsikt: plans with start/target %
// and tracked energy, Lad nå, Forvarm, guest windows, a few automatic stops.
// Deterministic (no randomness), relative to `now`.
function historySql(now: Date): string {
  const c = MOCK_CHARGER;
  const [roger, astrid] = MOCK_USERS;
  const day = 24 * 60 * 60 * 1000;
  const plans: string[] = [];
  const sessions: string[] = [];
  const stops: string[] = [];
  // Smartcar readings for Kjøring (design 6c): 07:00 and 19:00 UTC each day.
  // The car drives during the day; the battery rises only over a home session
  // in this history (night plan, Lad nå) -- except one charge elsewhere (d 20).
  const telemetry: string[] = [];
  let battery = 70;
  let odometer = 17000;
  const reading = (when: Date) =>
    telemetry.push(`(${battery}, ${ts(when)}, ${odometer.toFixed(1)}, ${ts(when)}, ${ts(when)})`);
  const at = (base: Date, hours: number, minutes: number) => {
    const date = new Date(base);
    date.setUTCHours(hours, minutes, 0, 0);
    return date;
  };
  for (let d = 58; d >= 3; d--) {
    const base = new Date(now.getTime() - d * day);
    {
      // Morning: after a night plan the battery is at its target.
      if (d % 3 === 0) battery = d % 4 === 0 ? 90 : 80;
      reading(at(base, 7, 0));
      // Daytime driving, ~6 km/kWh on a 46 kWh battery.
      const km = 25 + ((d * 13) % 30);
      odometer += km;
      battery = Math.max(10, Math.round(battery - (km / 6.2 / 46) * 100));
      if (d % 5 === 1) battery = Math.min(95, battery + Math.round(((4 + (d % 6)) / 46) * 100)); // Lad nå
      if (d === 20) battery = Math.min(95, battery + 30); // charged elsewhere
      reading(at(base, 19, 0));
    }
    if (d % 3 === 0) {
      // A night plan, ready 06:30 UTC (07:30 Oslo in winter)
      const by = d % 2 === 0 ? roger.id : astrid.id;
      const startPct = 30 + ((d * 7) % 25);
      const targetPct = d % 4 === 0 ? 90 : 80;
      const kwh = Math.round(((targetPct - startPct) / 100) * 46 * 10) / 10;
      const readyBy = at(base, 6, 30);
      const started = new Date(readyBy.getTime() - (kwh / 7) * 3_600_000 - 20 * 60_000);
      const ended = new Date(started.getTime() + (kwh / 7) * 3_600_000);
      const id = `00000000-0000-4000-8000-${String(1000 + d).padStart(12, "0")}`;
      plans.push(
        `(${q(id)}, ${q(by)}, ${q(c.id)}, ${q(c.name)}, ${kwh}, ${ts(readyBy)}, 'completed', ${ts(started)}, ${ts(ended)}, ` +
          `${ts(new Date(started.getTime() - 6 * 3_600_000))}, ${ts(ended)}, ${q(`mock-session-${d}`)}, 0, ${kwh}, ${startPct}, ${targetPct})`,
      );
    }
    if (d % 5 === 1) {
      const started = at(base, 16, 10);
      const kwh = 4 + (d % 6);
      const ended = new Date(started.getTime() + (kwh / 7) * 3_600_000);
      sessions.push(`(${q(c.id)}, ${q(d % 2 ? roger.id : astrid.id)}, 'manual', ${ts(started)}, ${ts(ended)}, ${kwh})`);
    }
    if (d % 9 === 4) {
      const started = at(base, 5, 50);
      sessions.push(`(${q(c.id)}, ${q(astrid.id)}, 'preheat', ${ts(started)}, ${ts(new Date(started.getTime() + 25 * 60_000))}, 1.2)`);
    }
    if (d === 12 || d === 40) {
      const started = at(base, 13, 0);
      sessions.push(`(${q(c.id)}, ${q(roger.id)}, 'guest', ${ts(started)}, ${ts(new Date(started.getTime() + 2.5 * 3_600_000))}, 18.4)`);
    }
    if (d % 7 === 2) {
      stops.push(`(${q(c.id)}, ${q(c.name)}, 'stopped_unplanned', ${ts(at(base, 17, 5))})`);
    }
  }
  // D70: sessions from before the app recorded its own, imported from Zaptec (no person).
  for (const [d, hour, kwh, hours] of [[66, 18, 21.4, 3.2], [79, 20, 14.8, 2.3]] as const) {
    const started = at(new Date(now.getTime() - d * day), hour, 5);
    const ended = new Date(started.getTime() + hours * 3_600_000);
    sessions.push(`(${q(c.id)}, NULL, 'imported', ${ts(started)}, ${ts(ended)}, ${kwh})`);
  }
  return `
INSERT INTO charge_schedules (id, created_by_user_id, charger_id, charger_name, target_energy_kwh, ready_by, status,
  started_at, ended_at, created_at, updated_at, zaptec_session_id, prior_session_energy_kwh, last_observed_session_energy_kwh,
  start_percent, target_percent) VALUES
  ${plans.join(",\n  ")};

INSERT INTO manual_charge_sessions (charger_id, started_by_user_id, kind, started_at, ended_at, energy_kwh) VALUES
  ${sessions.join(",\n  ")};

INSERT INTO activity_events (charger_id, charger_name, type, created_at) VALUES
  ${stops.join(",\n  ")};

INSERT INTO vehicle_telemetry (battery_percent, battery_reported_at, odometer_km, odometer_reported_at, created_at) VALUES
  ${telemetry.join(",\n  ")};
`;
}
