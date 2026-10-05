import { resolve } from "node:path";
import type { TestProject } from "vitest/node";
import { runMigrations } from "../../src/server/db/migrate";
import {
  assertDisposableTarget,
  createRunDatabase,
  dropRunDatabase,
  testDatabaseUrl,
} from "./database";
import { assertPostgresReachable } from "./postgres-precheck";

declare module "vitest" {
  export interface ProvidedContext {
    integrationDatabaseUrl: string;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

// Integration globalSetup: run the pure safety checks first (so nothing, not even a TCP
// connection, is attempted against a refused target), then fail fast with an actionable message
// if the disposable test server is down, create this run's own database, migrate it, and hand
// its URL to the tests. The returned teardown removes only that database.
export default async function setup(project: TestProject) {
  const { host, port } = assertDisposableTarget(testDatabaseUrl(), process.env);
  await assertPostgresReachable(host, port);

  const runUrl = await createRunDatabase();
  try {
    await runMigrations(runUrl, resolve(import.meta.dirname, "../../drizzle"));
  } catch (error) {
    await dropRunDatabase().catch((cleanupError) => {
      console.warn(
        `Warning: could not remove the integration test database after a migration failure: ${describeError(cleanupError)}`,
      );
    });
    throw error;
  }
  project.provide("integrationDatabaseUrl", runUrl);

  return async () => {
    try {
      await dropRunDatabase();
    } catch (error) {
      console.warn(
        `Warning: could not remove the integration test database: ${describeError(error)}`,
      );
    }
  };
}
