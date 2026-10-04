import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { webhookEvents, chargeSessions } from "@/lib/db/schema";

function isAuthorized(request: NextRequest): boolean {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf-8");
  const [username, password] = decoded.split(":");
  return username === env.ZAPTEC_WEBHOOK_USERNAME && password === env.ZAPTEC_WEBHOOK_PASSWORD;
}

// Logs session-end notifications for history. The payload shape isn't fully
// documented publicly, so this stores the raw body for debugging and only
// best-effort extracts a few likely fields; it never blocks or denies a session.
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);

  await db.insert(webhookEvents).values({
    eventType: "session-end",
    payload: payload ?? {},
  });

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const chargerId = String(record.ChargerId ?? record.chargerId ?? "");
    if (chargerId) {
      await db.insert(chargeSessions).values({
        chargerId,
        zaptecSessionId: record.SessionId ? String(record.SessionId) : null,
        energyKwh:
          record.Energy != null
            ? String(record.Energy)
            : record.energy != null
              ? String(record.energy)
              : null,
        endedAt: new Date(),
      });
    }
  }

  return NextResponse.json({ ok: true });
}
