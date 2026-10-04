// One-off CLI to add a household member. Not part of the running app, since
// this is a private household tool with no self-signup flow.
//
// Usage: npx tsx scripts/add-user.mts <email> <name> <password>
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import bcrypt from "bcryptjs";
import { users } from "../src/lib/db/schema";

async function main() {
  const [email, name, password] = process.argv.slice(2);
  if (!email || !name || !password) {
    console.error("Usage: npx tsx scripts/add-user.mts <email> <name> <password>");
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set (check .env.local)");
    process.exit(1);
  }

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  const passwordHash = await bcrypt.hash(password, 12);
  await db.insert(users).values({ email: email.toLowerCase(), name, passwordHash });

  console.log(`Added user ${email}`);
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
