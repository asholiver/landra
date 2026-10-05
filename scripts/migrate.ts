import { resolve } from "node:path";
import { runMigrations } from "../src/server/db/migrate";

// Applies committed migrations using the direct (unpooled) URL. Used locally and by CI.
const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set.");
  process.exit(1);
}

try {
  await runMigrations(connectionString, resolve(import.meta.dirname, "../drizzle"));
  console.log("Migrations applied.");
} catch (error) {
  console.error("Migration failed:", error instanceof Error ? error.message : "unknown error");
  process.exit(1);
}
