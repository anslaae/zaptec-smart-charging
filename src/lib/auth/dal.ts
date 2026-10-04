import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { decryptSession, getSessionCookieValue } from "./session";

export const verifySession = cache(async () => {
  const token = await getSessionCookieValue();
  const session = await decryptSession(token);

  if (!session?.userId) {
    redirect("/login");
  }

  return { userId: session.userId };
});

export const getCurrentUser = cache(async () => {
  const session = await verifySession();

  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user) {
    redirect("/login");
  }

  return user;
});
