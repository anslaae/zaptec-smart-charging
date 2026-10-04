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
});

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  ZAPTEC_USERNAME: process.env.ZAPTEC_USERNAME,
  ZAPTEC_PASSWORD: process.env.ZAPTEC_PASSWORD,
  CRON_SECRET: process.env.CRON_SECRET,
  ZAPTEC_WEBHOOK_USERNAME: process.env.ZAPTEC_WEBHOOK_USERNAME,
  ZAPTEC_WEBHOOK_PASSWORD: process.env.ZAPTEC_WEBHOOK_PASSWORD,
});
