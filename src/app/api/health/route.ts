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

export async function GET() {
  const now = new Date();
  let databaseOk = true;
  let scheduler: SchedulerHealth;

  try {
    const [row] = await db
      .select({ lastTickAt: schedulerHeartbeat.lastTickAt })
      .from(schedulerHeartbeat)
      .where(eq(schedulerHeartbeat.id, "singleton"))
      .limit(1);

    const lastTickAt = row?.lastTickAt ?? null;
    const secondsSinceLastTick = lastTickAt
      ? Math.floor((now.getTime() - lastTickAt.getTime()) / 1000)
      : null;
    scheduler = {
      lastTickAt: lastTickAt ? lastTickAt.toISOString() : null,
      secondsSinceLastTick,
      stale: secondsSinceLastTick == null || secondsSinceLastTick > STALE_AFTER_SECONDS,
    };
  } catch {
    databaseOk = false;
    scheduler = { lastTickAt: null, secondsSinceLastTick: null, stale: true };
  }

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
