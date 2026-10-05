import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` only reads the schema; it needs no database. Never run
// `drizzle-kit push` against a shared database (ADR-0003): migrations are generated,
// reviewed as SQL and applied with `pnpm db:migrate`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
});
