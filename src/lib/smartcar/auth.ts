import "server-only";
import { env } from "@/lib/env";
import { SMARTCAR_TOKEN_URL } from "./constants";
import type { SmartcarTokenResponse } from "./types";

// Module-level cache: persists across invocations on a warm serverless
// instance, re-fetched whenever missing or close to expiry. Same shape as
// zaptec/auth.ts's cache, but Smartcar's v3 API authenticates at the
// application level (Client Credentials, no per-user refresh token) rather
// than Zaptec's ROPC -- one token is shared across every vehicle/user this
// app's credentials have access to.
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

const EXPIRY_SAFETY_MARGIN_MS = 60_000;

export async function getSmartcarAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - EXPIRY_SAFETY_MARGIN_MS > Date.now()) {
    return cachedToken.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.SMARTCAR_CLIENT_ID!,
    client_secret: env.SMARTCAR_CLIENT_SECRET!,
  });

  const response = await fetch(SMARTCAR_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Smartcar auth failed: ${response.status} ${await response.text()}`,
    );
  }

  const data = (await response.json()) as SmartcarTokenResponse;

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.accessToken;
}
