import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { integrationDatabaseUrl } from "./helpers";

// globalSetup applied the committed migrations to an empty database.
describe("migrations", () => {
  const pool = new pg.Pool({ connectionString: integrationDatabaseUrl(), max: 1 });
  afterAll(() => pool.end());

  it("created the Better Auth tables and allowed_email", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const names = rows.map((row) => row.table_name);
    for (const table of ["user", "session", "account", "verification", "allowed_email"]) {
      expect(names).toContain(table);
    }
  });

  it("uses timestamptz and a lower-case primary key on allowed_email", async () => {
    const { rows } = await pool.query<{ column_name: string; data_type: string }>(
      "select column_name, data_type from information_schema.columns where table_name = 'allowed_email'",
    );
    expect(Object.fromEntries(rows.map((row) => [row.column_name, row.data_type]))).toEqual({
      email: "text",
      created_at: "timestamp with time zone",
      note: "text",
    });
  });
});
