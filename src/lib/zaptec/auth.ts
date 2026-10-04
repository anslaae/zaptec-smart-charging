import "server-only";
import { env } from "@/lib/env";
import { ZAPTEC_TOKEN_URL } from "./constants";
import type { ZaptecTokenResponse } from "./types";

// Module-level cache: persists across invocations on a warm serverless instance,
// re-fetched whenever missing or close to expiry. Not shared across instances,
// which is fine since the token endpoint is cheap and rate limits are generous.
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

const EXPIRY_SAFETY_MARGIN_MS = 60_000;

export async function getZaptecAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - EXPIRY_SAFETY_MARGIN_MS > Date.now()) {
    return cachedToken.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: "password",
    username: env.ZAPTEC_USERNAME,
    password: env.ZAPTEC_PASSWORD,
  });

  const response = await fetch(ZAPTEC_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Zaptec auth failed: ${response.status} ${await response.text()}`,
    );
  }

  const data = (await response.json()) as ZaptecTokenResponse;

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.accessToken;
}
