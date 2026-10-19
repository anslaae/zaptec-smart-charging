import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { schedulerHeartbeat } from "@/lib/db/schema";
import { STALE_AFTER_SECONDS } from "@/lib/scheduler/heartbeat";

// Public (excluded from the auth proxy) so an external uptime monitor can
// hit this with no login. Deliberately doesn't check Zaptec connectivity --
// pinging that on every uptime check (often every 1-5 min) would add exactly
// the kind of aggressive, automation-driven polling Zaptec's fair-use policy
// asks integrators to avoid, for a thing we already poll separately anyway.
export const dynamic = "force-dynamic";

interface SchedulerHealth {
  lastTickAt: string | null;
  secondsSinceLastTick: number | null;
  stale: boolean;
}

// An uptime monitor's ping interval is outside this app's control, and every
// ping otherwise reads the database -- which, on a warm Vercel instance,
// would on its own be enough to keep Neon's compute from ever going idle
// regardless of how infrequently the scheduler tick touches it (see
// tick-gate.ts). This cache just deduplicates the DB read itself, so it only
// caches the raw lastTickAt/databaseOk -- secondsSinceLastTick and stale are
// still derived fresh against the real current time on every request.
const HEALTH_CACHE_TTL_MS = 60 * 1000;
let cachedRow: { lastTickAt: Date | null; databaseOk: boolean; at: number } | null = null;

async function getCachedLastTick(now: number): Promise<{ lastTickAt: Date | null; databaseOk: boolean }> {
  if (cachedRow && now - cachedRow.at < HEALTH_CACHE_TTL_MS) {
    return cachedRow;
  }
  try {
    const [row] = await db
      .select({ lastTickAt: schedulerHeartbeat.lastTickAt })
      .from(schedulerHeartbeat)
      .where(eq(schedulerHeartbeat.id, "singleton"))
      .limit(1);
    cachedRow = { lastTickAt: row?.lastTickAt ?? null, databaseOk: true, at: now };
  } catch {
    cachedRow = { lastTickAt: null, databaseOk: false, at: now };
  }
  return cachedRow;
}

export async function GET() {
  const now = new Date();
  const { lastTickAt, databaseOk } = await getCachedLastTick(now.getTime());

  const secondsSinceLastTick = lastTickAt
    ? Math.floor((now.getTime() - lastTickAt.getTime()) / 1000)
    : null;
  const scheduler: SchedulerHealth = {
    lastTickAt: lastTickAt ? lastTickAt.toISOString() : null,
    secondsSinceLastTick,
    stale: secondsSinceLastTick == null || secondsSinceLastTick > STALE_AFTER_SECONDS,
  };

  const healthy = databaseOk && !scheduler.stale;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      sha: process.env.BUILD_SHA ?? "unknown",
      env: process.env.BUILD_ENV ?? "unknown",
      time: now.toISOString(),
      database: { ok: databaseOk },
      scheduler,
    },
    { status: healthy ? 200 : 503 },
  );
}
