// One-time import of Zaptec sessions from before the app recorded its own
// (DECISIONS.md D70) as manual_charge_sessions rows of kind "imported".
//
//   npx tsx scripts/import-zaptec-history.mts           # dry run: lists what it would insert
//   npx tsx scripts/import-zaptec-history.mts --apply   # inserts them
//
// Reads Zaptec with GET only (/api/chargers, /api/chargehistory) -- never a
// command. Skips sessions the app already has (same zaptec_session_id, or an
// app row without one that started inside the session), so running it again
// inserts nothing new. Uses DATABASE_URL and ZAPTEC_USERNAME/PASSWORD from
// .env.local -- that is the production database.
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { asc, isNotNull } from "drizzle-orm";
import { cars, chargeSchedules, manualChargeSessions } from "../src/lib/db/schema";
import { planImport, type ZaptecHistorySession } from "../src/lib/importHistory";

config({ path: ".env.local" });

const API = "https://api.zaptec.com";
const PAGE_SIZE = 100;

async function token(): Promise<string> {
  const { ZAPTEC_USERNAME, ZAPTEC_PASSWORD } = process.env;
  if (!ZAPTEC_USERNAME || !ZAPTEC_PASSWORD) throw new Error("ZAPTEC_USERNAME / ZAPTEC_PASSWORD not set (check .env.local)");
  const response = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", username: ZAPTEC_USERNAME, password: ZAPTEC_PASSWORD }),
  });
  if (!response.ok) throw new Error(`Zaptec auth failed: ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function get<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  if (!response.ok) throw new Error(`GET ${path} failed: ${response.status}`);
  return (await response.json()) as T;
}

async function zaptecSessions(accessToken: string): Promise<(ZaptecHistorySession & { chargerId: string; chargerName: string })[]> {
  const chargers = (await get<{ Data: { Id: string; Name: string }[] }>("/api/chargers", accessToken)).Data;
  const all: (ZaptecHistorySession & { chargerId: string; chargerName: string })[] = [];
  for (const charger of chargers) {
    for (let page = 0; ; page++) {
      const data = await get<{
        Pages: number;
        Data: { Id: string; StartDateTime: string; EndDateTime: string | null; Energy: number }[];
      }>(`/api/chargehistory?ChargerId=${charger.Id}&PageSize=${PAGE_SIZE}&PageIndex=${page}`, accessToken);
      for (const e of data.Data) {
        all.push({ id: e.Id, startedAt: e.StartDateTime, endedAt: e.EndDateTime, energyKwh: e.Energy, chargerId: charger.Id, chargerName: charger.Name });
      }
      if (data.Data.length === 0 || page + 1 >= data.Pages) break;
    }
  }
  return all;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set (check .env.local)");
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);
  try {
    const sessions = await zaptecSessions(await token());
    const [plans, rows, [car]] = await Promise.all([
      db
        .select({ zaptecSessionId: chargeSchedules.zaptecSessionId, startedAt: chargeSchedules.startedAt })
        .from(chargeSchedules)
        .where(isNotNull(chargeSchedules.startedAt)),
      db
        .select({ zaptecSessionId: manualChargeSessions.zaptecSessionId, startedAt: manualChargeSessions.startedAt })
        .from(manualChargeSessions),
      db.select({ id: cars.id }).from(cars).orderBy(asc(cars.createdAt)).limit(1),
    ]);
    const appRows = [...plans.map((p) => ({ zaptecSessionId: p.zaptecSessionId, startedAt: p.startedAt! })), ...rows];
    const { insert, skipped } = planImport(sessions, appRows);

    console.log(`Zaptec: ${sessions.length} sessions; already covered/skipped: ${skipped.length}; to import: ${insert.length}`);
    for (const s of skipped) console.log(`  skip ${s.session.startedAt}  ${s.session.energyKwh.toFixed(2)} kWh  (${s.reason})`);
    const byId = new Map(sessions.map((s) => [s.id, s]));
    let total = 0;
    for (const row of insert) {
      total += row.energyKwh;
      console.log(`  ${apply ? "insert" : "would insert"} ${row.startedAt.toISOString()} – ${row.endedAt.toISOString()}  ${row.energyKwh.toFixed(2)} kWh  ${row.zaptecSessionId}`);
    }
    console.log(`  total ${total.toFixed(2)} kWh`);

    if (!apply) {
      console.log("Dry run -- nothing written. Run with --apply to insert.");
      return;
    }
    if (insert.length === 0) return;
    await db.transaction(async (tx) => {
      await tx.insert(manualChargeSessions).values(
        insert.map((row) => ({
          chargerId: byId.get(row.zaptecSessionId)!.chargerId,
          kind: "imported",
          carId: car?.id ?? null,
          startedByUserId: null,
          zaptecSessionId: row.zaptecSessionId,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
          energyKwh: row.energyKwh.toFixed(2),
        })),
      );
    });
    console.log(`Inserted ${insert.length} rows.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
