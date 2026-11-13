// For unit tests only: an in-memory Postgres (PGlite) built from the real
// Drizzle migrations, shaped like "@/lib/db". Use it as
//   vi.mock("@/lib/db", async () => (await import("@/lib/db/testDb")).createTestDb());
import { readFileSync } from "node:fs";
import path from "node:path";

export async function createTestDb() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/lib/db/schema");
  const dir = path.join(process.cwd(), "drizzle");
  const journal = JSON.parse(readFileSync(path.join(dir, "meta", "_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  const client = new PGlite();
  await client.exec(
    journal.entries
      .map((e) => readFileSync(path.join(dir, `${e.tag}.sql`), "utf8").split("--> statement-breakpoint").join("\n"))
      .join("\n"),
  );
  return { db: drizzle(client, { schema }) };
}
