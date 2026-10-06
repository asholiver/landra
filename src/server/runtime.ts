import { type Auth, createAuth } from "./auth/auth";
import { getConfig } from "./config";
import { createDatabase } from "./db/client";
import { createLogger } from "./logging/logger";

/** Process-wide singletons, created lazily so importing a route never requires env vars. */
export const logger = createLogger();

let runtime: { auth: Auth; database: ReturnType<typeof createDatabase>["db"] } | undefined;

function getRuntime() {
  if (!runtime) {
    const config = getConfig();
    const { db } = createDatabase(config.databaseUrl);
    runtime = { database: db, auth: createAuth({ database: db, config, logger }) };
  }
  return runtime;
}

export const getAuth = () => getRuntime().auth;
export const getDatabase = () => getRuntime().database;
