/**
 * Deterministic, explicitly NON-SECRET configuration for the E2E web server. It is defined here
 * and nowhere else: the server never reads .env or the ambient shell (see global-setup.ts),
 * and the session fixture signs cookies with the same values.
 */
export const E2E_PORT = 4173;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/** A throwaway value that only ever protects the disposable test database's sessions. */
export const E2E_AUTH_SECRET = "e2e-throwaway-value-0123456789-abcdefghijkl";

/** Name of the process.env variable through which workers learn this run's database URL. */
export const RUN_DATABASE_ENV = "E2E_RUN_DATABASE_URL";
/** ...and the file the server's log lines are written to (read by the logging test). */
export const SERVER_LOG_ENV = "E2E_SERVER_LOG_FILE";

export function e2eServerEnvironment(databaseUrl: string): Record<string, string> {
  return {
    NODE_ENV: "test",
    PORT: String(E2E_PORT),
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: E2E_AUTH_SECRET,
    BETTER_AUTH_URL: E2E_BASE_URL,
    GIT_SHA: "e2e",
    // Deliberately no Google credentials: sign-in must report "not configured" (Stage 0).
  };
}
