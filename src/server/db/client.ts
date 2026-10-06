import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDatabase>["db"];

/**
 * Creates a Drizzle client over a bounded `pg` pool.
 *
 * O1 (Neon driver): `pg` against Neon's pooled (PgBouncer) connection string. The same code
 * path serves local Docker Postgres, so there is no driver switch. The pool is small because
 * each serverless instance holds its own and Neon's pooler multiplexes the rest.
 */
export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    // Allows for a Neon cold start (scale-to-zero) on the first request.
    connectionTimeoutMillis: 15_000,
    statement_timeout: 15_000,
  });
  // An idle client erroring (for example Neon suspending compute) must not crash the process.
  pool.on("error", () => {});
  return { db: drizzle(pool, { schema }), pool };
}
