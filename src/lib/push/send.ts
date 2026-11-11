import "server-only";
import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";
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
    return { devices: 1 };
  }
  if (!vapidConfigured) return { devices: 0 };

  const subscriptions = userId
    ? await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
    : await db.select().from(pushSubscriptions);
  if (subscriptions.length === 0) return { devices: 0 };

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
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        } else {
          console.error(
            `[push] failed to send to subscription ${sub.id}: ${error instanceof Error ? error.message : error}`,
          );
        }
      }
    }),
  );
  return { devices: subscriptions.length };
}
