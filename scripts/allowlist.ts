import { runAllowlistCommand } from "../src/server/allowlist/cli";
import { createDatabase } from "../src/server/db/client";

// pnpm allowlist add|remove <email> | list   (uses DATABASE_URL)
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL must be set (see .env.example).");
  process.exit(1);
}

const { db, pool } = createDatabase(connectionString);
try {
  const { exitCode, output } = await runAllowlistCommand(db, process.argv.slice(2));
  if (output) (exitCode === 0 ? console.log : console.error)(output);
  process.exitCode = exitCode;
} catch (error) {
  console.error(
    "Allowlist command failed:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
