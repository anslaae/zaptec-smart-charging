import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Same precedence as src/lib/env.ts (staged Neon -> Supabase migration).
    url: (process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL)!,
  },
});
