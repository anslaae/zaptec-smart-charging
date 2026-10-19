import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

// idle_timeout closes the TCP connection after 20s of no queries, so a warm
// Vercel function instance doesn't hold one open indefinitely between
// invocations -- an open connection can itself be enough to keep Neon's
// compute from ever seeing this as idle, regardless of query frequency.
const client = postgres(env.DATABASE_URL, { max: 1, idle_timeout: 20 });

export const db = drizzle(client, { schema });
