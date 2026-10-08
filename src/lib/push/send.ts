import "server-only";
import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";
import { env } from "@/lib/env";

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

export interface PushPayload {
  title: string;
  body: string;
}

// Sends to every subscribed device, household-wide -- there's no per-event
// targeting (yet; see the per-user-configurable backlog item). A dead
// subscription (device unenrolled, browser data cleared, permission
// revoked) fails with 404/410 from the push service; those rows are pruned
// so they don't keep failing forever. Never throws -- a notification
// failure should never break the scheduler tick or action that triggered it.
export async function sendPushToAllSubscribers(payload: PushPayload): Promise<void> {
  if (!vapidConfigured) return;

  const subscriptions = await db.select().from(pushSubscriptions);
  if (subscriptions.length === 0) return;

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
}
