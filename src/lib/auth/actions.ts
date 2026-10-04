"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "./password";
import { createSession, deleteSession } from "./session";

const LoginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export interface LoginState {
  error?: string;
}

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Enter a valid email and password." };
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, parsed.data.email.toLowerCase()))
    .limit(1);

  // Compare against a dummy hash when the user doesn't exist, so the response
  // time doesn't reveal whether an email is registered.
  const passwordHash = user?.passwordHash ?? "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinval";
  const passwordMatches = await verifyPassword(parsed.data.password, passwordHash);

  if (!user || !passwordMatches) {
    return { error: "Invalid email or password." };
  }

  await createSession(user.id);
  redirect("/");
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/login");
}
