import "server-only";
import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pushLog, pushSubscriptions } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { MOCK_MODE } from "@/lib/mock/mode";
import { mockLog } from "@/lib/mock/store";

const vapidConfigured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
if (vapidConfigured) {
  webpush.setVapidDetails(
    // Any https URL identifying the app is valid as the VAPID subject --
    // there's no dedicated support mailbox for this household project.
    "https://zaptec-smart-charging.vercel.app",
    env.VAPID_PUBLIC_KEY!,
    env.VAPID_PRIVATE_KEY!,
  );
}

export interface PushAction {
  action: string;
  title: string;
  url: string;
}

// Shape public/sw.js reads (design/redesign/notifications.nb.json). icon/badge
// default in the service worker. `tag` groups a plan's or charger's
// notifications so a new one replaces the previous; `url` is opened on tap;
// `actions` only render on Android/Chrome.
export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  actions?: PushAction[];
  /** notifications.nb.json event id, recorded in push_log (D87); the service worker ignores it. */
  event?: string;
}

// Sends to every subscribed device, household-wide -- there's no per-event
// targeting (yet; see the per-user-configurable backlog item). A dead
// subscription (device unenrolled, browser data cleared, permission
// revoked) fails with 404/410 from the push service; those rows are pruned
// so they don't keep failing forever. Never throws -- a notification
// failure should never break the scheduler tick or action that triggered it.
export async function sendPushToAllSubscribers(payload: PushPayload): Promise<void> {
  await sendPush(payload, null);
}

/** Only this person's devices -- the Innstillinger test notification (UC12). */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<{ devices: number }> {
  return sendPush(payload, userId);
}

async function sendPush(payload: PushPayload, userId: string | null): Promise<{ devices: number }> {
  // Mock mode: nothing leaves the machine; the payload shows up in /dev/mock.
  if (MOCK_MODE) {
    mockLog("push", `${userId ? "(én bruker) " : ""}${payload.title} — ${payload.body}${payload.tag ? ` [tag ${payload.tag}]` : ""}${payload.url ? ` → ${payload.url}` : ""}`);
    await recordPush(payload, userId, { attempted: 1, ok: 1, errors: [] });
    return { devices: 1 };
  }
  if (!vapidConfigured) {
    await recordPush(payload, userId, { attempted: 0, ok: 0, errors: ["VAPID not configured"] });
    return { devices: 0 };
  }

  const subscriptions = userId
    ? await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
    : await db.select().from(pushSubscriptions);
  if (subscriptions.length === 0) {
    await recordPush(payload, userId, { attempted: 0, ok: 0, errors: [] });
    return { devices: 0 };
  }

  const errors: string[] = [];
  let ok = 0;
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
        );
        ok++;
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${sub.id}: ${statusCode ?? "-"} ${message}`.slice(0, 500));
        if (statusCode === 404 || statusCode === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        } else {
          console.error(`[push] failed to send to subscription ${sub.id}: ${message}`);
        }
      }
    }),
  );
  await recordPush(payload, userId, { attempted: subscriptions.length, ok, errors });
  return { devices: subscriptions.length };
}

// D87: one push_log row per send. Bookkeeping only -- a failure here is
// logged and swallowed, never thrown into the send or the tick.
async function recordPush(
  payload: PushPayload,
  userId: string | null,
  result: { attempted: number; ok: number; errors: string[] },
): Promise<void> {
  try {
    await db.insert(pushLog).values({
      title: payload.title,
      tag: payload.tag ?? null,
      event: payload.event ?? null,
      userId,
      devicesAttempted: result.attempted,
      devicesOk: result.ok,
      errors: result.errors.length ? result.errors.join("\n") : null,
    });
  } catch (error) {
    console.error("[push] push_log write failed:", error instanceof Error ? error.message : error);
  }
}
