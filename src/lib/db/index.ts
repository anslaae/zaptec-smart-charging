import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import { MOCK_MODE } from "@/lib/mock/mode";
import { getMockDb } from "@/lib/mock/db";
import * as schema from "./schema";

function createDb(): PostgresJsDatabase<typeof schema> {
  // Mock mode: an in-memory Postgres with the same schema (src/lib/mock/db.ts).
  // Both are Drizzle Postgres databases, so every query is the same code.
  if (MOCK_MODE) return getMockDb() as unknown as PostgresJsDatabase<typeof schema>;

  // idle_timeout closes the TCP connection after 20s of no queries, so a warm
  // Vercel function instance doesn't hold one open indefinitely between
  // invocations, tying up one of the Supabase session pooler's limited client
  // slots (session mode pins a server connection to each client connection).
  const client = postgres(env.DATABASE_URL, { max: 1, idle_timeout: 20 });
  return drizzle(client, { schema });
}

export const db = createDb();
