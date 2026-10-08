"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { verifySession } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";

const SubscriptionSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export interface PushActionResult {
  error?: string;
  success?: boolean;
}

export async function subscribeToPush(subscription: unknown): Promise<PushActionResult> {
  const session = await verifySession();

  const parsed = SubscriptionSchema.safeParse(subscription);
  if (!parsed.success) {
    return { error: "Invalid push subscription." };
  }

  try {
    await db
      .insert(pushSubscriptions)
      .values({
        userId: session.userId,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
      })
      // The same browser subscribing again (e.g. after re-granting
      // permission) should just refresh the keys, not fail on the unique
      // endpoint constraint or create a duplicate row.
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: session.userId, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth },
      });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to save subscription." };
  }

  return { success: true };
}

export async function unsubscribeFromPush(endpoint: string): Promise<PushActionResult> {
  await verifySession();

  try {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to remove subscription." };
  }

  return { success: true };
}
