import "server-only";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import * as schema from "@/lib/db/schema";
import { seedSql } from "./seed";

// In-memory Postgres (PGlite, WASM) for mock mode, built from the real Drizzle
// migrations so every query in the app runs unchanged. Nothing is written to
// disk; a dev-server restart starts from the seed again.
//
// PGlite and drizzle's pglite driver are loaded with a runtime require (not an
// import) so they're never bundled into, or loaded by, a production build.

type MockDb = ReturnType<typeof import("drizzle-orm/pglite").drizzle<typeof schema>>;
type PGliteClient = InstanceType<typeof import("@electric-sql/pglite").PGlite>;

const globalForMockDb = globalThis as typeof globalThis & {
  __zaptecMockDb?: MockDb;
  __zaptecMockClient?: PGliteClient;
};

const ALL_TABLES = [
  "schedule_actions",
  "settings",
  "cars",
  "chargers",
  "locations",
  "charge_sessions",
  "push_subscriptions",
  "manual_charge_sessions",
  "activity_events",
  "charge_schedules",
  "vehicle_telemetry",
  "webhook_events",
  "scheduler_heartbeat",
  "charger_observed_state",
  "charger_state_log",
  "users",
];

/** Back to the seed: empties every table and re-inserts the seed rows. */
export async function resetMockDb(): Promise<void> {
  getMockDb();
  const client = globalForMockDb.__zaptecMockClient!;
  await client.exec(`TRUNCATE ${ALL_TABLES.join(", ")} CASCADE;\n${seedSql(new Date())}`);
}

function schemaSql(): string {
  const dir = path.join(process.cwd(), "drizzle");
  const journal = JSON.parse(readFileSync(path.join(dir, "meta", "_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  return journal.entries
    .map((e) => readFileSync(path.join(dir, `${e.tag}.sql`), "utf8").split("--> statement-breakpoint").join("\n"))
    .join("\n");
}

export function getMockDb(): MockDb {
  if (globalForMockDb.__zaptecMockDb) return globalForMockDb.__zaptecMockDb;

  const runtimeRequire = createRequire(path.join(process.cwd(), "package.json"));
  const { PGlite } = runtimeRequire("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  const { drizzle } = runtimeRequire("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");

  const client = new PGlite();
  // Not awaited on purpose: PGlite runs queries one at a time, so every query
  // the app issues waits behind this schema + seed batch.
  void client.exec(`${schemaSql()}\n${seedSql(new Date())}`).catch((error: unknown) => {
    console.error("[mock] failed to build the in-memory database:", error);
  });

  const db = drizzle(client, { schema });
  globalForMockDb.__zaptecMockDb = db;
  globalForMockDb.__zaptecMockClient = client;
  return db;
}
