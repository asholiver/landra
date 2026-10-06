import { inject } from "vitest";
import { createAuth } from "../../src/server/auth/auth";
import { loadConfig } from "../../src/server/config";
import { createDatabase } from "../../src/server/db/client";
import { createLogger } from "../../src/server/logging/logger";

/** This run's own database (created and migrated by globalSetup). The only URL tests use. */
export function integrationDatabaseUrl(): string {
  return inject("integrationDatabaseUrl");
}

export function testEnvironment(): Record<string, string> {
  return {
    NODE_ENV: "test",
    DATABASE_URL: integrationDatabaseUrl(),
    BETTER_AUTH_SECRET: "integration-test-secret-0123456789abcdef",
    BETTER_AUTH_URL: "http://localhost:5173",
  };
}

export function createTestRuntime(overrides: Record<string, string> = {}) {
  const config = loadConfig({ ...testEnvironment(), ...overrides });
  const { db, pool } = createDatabase(config.databaseUrl);
  const logLines: string[] = [];
  const logger = createLogger({ write: (line) => logLines.push(line) });
  const auth = createAuth({ database: db, config, logger });
  return { config, db, pool, auth, logLines };
}
