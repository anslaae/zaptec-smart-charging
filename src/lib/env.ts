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
  // When "true", sendChargerCommand() logs instead of calling the real
  // Zaptec API. Lets us exercise the full cron/scheduler pipeline (including
  // real charger state reads) without actually starting/stopping charging.
  SIMULATE_CHARGER_COMMANDS: z
    .string()
    .optional()
    .default("false")
    .transform((value) => value === "true"),
});

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  ZAPTEC_USERNAME: process.env.ZAPTEC_USERNAME,
  ZAPTEC_PASSWORD: process.env.ZAPTEC_PASSWORD,
  CRON_SECRET: process.env.CRON_SECRET,
  ZAPTEC_WEBHOOK_USERNAME: process.env.ZAPTEC_WEBHOOK_USERNAME,
  ZAPTEC_WEBHOOK_PASSWORD: process.env.ZAPTEC_WEBHOOK_PASSWORD,
  SIMULATE_CHARGER_COMMANDS: process.env.SIMULATE_CHARGER_COMMANDS,
});
