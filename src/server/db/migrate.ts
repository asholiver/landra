import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/** Applies committed SQL migrations. Use the direct (unpooled) URL: DDL must not go through a pooler. */
export async function runMigrations(
  connectionString: string,
  migrationsFolder: string,
  options: { schema?: string } = {},
): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 15_000 });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder,
      ...(options.schema ? { migrationsSchema: options.schema } : {}),
    });
  } finally {
    await pool.end();
  }
}
