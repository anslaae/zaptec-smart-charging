import "server-only";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  SESSION_SECRET: z.string().min(32),
  ZAPTEC_USERNAME: z.string().min(1),
  ZAPTEC_PASSWORD: z.string().min(1),
  CRON_SECRET: z.string().min(16),
  ZAPTEC_WEBHOOK_USERNAME: z.string().min(1),
  ZAPTEC_WEBHOOK_PASSWORD: z.string().min(1),
  // Optional, not required: until these are added to Vercel's env vars,
  // push notifications should silently no-op (see src/lib/push/send.ts)
  // rather than crash every page on this module's import -- the charging
  // app shouldn't go down because notifications aren't configured yet.
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  // Optional, not required: Smartcar (car battery state of charge) is a
  // nice-to-have alongside the Zaptec charger integration -- until these are
  // set, src/lib/smartcar/client.ts silently no-ops rather than crashing the
  // dashboard, same reasoning as the VAPID keys above.
  SMARTCAR_CLIENT_ID: z.string().min(1).optional(),
  SMARTCAR_CLIENT_SECRET: z.string().min(1).optional(),
  SMARTCAR_VEHICLE_ID: z.string().min(1).optional(),
  SMARTCAR_USER_ID: z.string().min(1).optional(),
  // Used only to verify Smartcar webhook deliveries (HMAC-SHA256 of the raw
  // body/challenge) -- separate credential from the client ID/secret above.
  SMARTCAR_APPLICATION_MANAGEMENT_TOKEN: z.string().min(1).optional(),
});

// Mock mode (local only, see src/lib/mock/mode.ts): every credential is
// replaced with an obviously fake value, so even a code path the mock missed
// can't reach the real database, charger or Smartcar with real credentials.
const MOCK_ENV =
  process.env.MOCK_MODE === "1"
    ? {
        DATABASE_URL: "postgres://mock:mock@127.0.0.1:1/mock",
        SESSION_SECRET: "mock-session-secret-not-for-real-use-0000",
        ZAPTEC_USERNAME: "mock",
        ZAPTEC_PASSWORD: "mock",
        CRON_SECRET: "mock-cron-secret-0000",
        ZAPTEC_WEBHOOK_USERNAME: "mock",
        ZAPTEC_WEBHOOK_PASSWORD: "mock-webhook-password",
        VAPID_PUBLIC_KEY: undefined,
        VAPID_PRIVATE_KEY: undefined,
        SMARTCAR_CLIENT_ID: "mock",
        SMARTCAR_CLIENT_SECRET: "mock",
        SMARTCAR_VEHICLE_ID: "mock",
        SMARTCAR_USER_ID: "mock",
        SMARTCAR_APPLICATION_MANAGEMENT_TOKEN: "mock-smartcar-amt",
      }
    : null;

export const env = MOCK_ENV ? envSchema.parse(MOCK_ENV) : envSchema.parse({
  // Neon -> Supabase migration, staged: SUPABASE_DATABASE_URL wins when set,
  // so adding it in Vercel (next to Neon's integration-managed DATABASE_URL)
  // and redeploying switches databases, and removing it switches back. Once
  // Neon is gone, rename it to DATABASE_URL and drop this fallback (also in
  // drizzle.config.ts and scripts/add-user.mts).
  DATABASE_URL: process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  ZAPTEC_USERNAME: process.env.ZAPTEC_USERNAME,
  ZAPTEC_PASSWORD: process.env.ZAPTEC_PASSWORD,
  CRON_SECRET: process.env.CRON_SECRET,
  ZAPTEC_WEBHOOK_USERNAME: process.env.ZAPTEC_WEBHOOK_USERNAME,
  ZAPTEC_WEBHOOK_PASSWORD: process.env.ZAPTEC_WEBHOOK_PASSWORD,
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  SMARTCAR_CLIENT_ID: process.env.SMARTCAR_CLIENT_ID,
  SMARTCAR_CLIENT_SECRET: process.env.SMARTCAR_CLIENT_SECRET,
  SMARTCAR_VEHICLE_ID: process.env.SMARTCAR_VEHICLE_ID,
  SMARTCAR_USER_ID: process.env.SMARTCAR_USER_ID,
  SMARTCAR_APPLICATION_MANAGEMENT_TOKEN: process.env.SMARTCAR_APPLICATION_MANAGEMENT_TOKEN,
});
