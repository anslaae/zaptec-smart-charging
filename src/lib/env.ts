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
});

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  ZAPTEC_USERNAME: process.env.ZAPTEC_USERNAME,
  ZAPTEC_PASSWORD: process.env.ZAPTEC_PASSWORD,
  CRON_SECRET: process.env.CRON_SECRET,
  ZAPTEC_WEBHOOK_USERNAME: process.env.ZAPTEC_WEBHOOK_USERNAME,
  ZAPTEC_WEBHOOK_PASSWORD: process.env.ZAPTEC_WEBHOOK_PASSWORD,
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
});
