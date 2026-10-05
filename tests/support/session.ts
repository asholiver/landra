import { makeSignature } from "better-auth/crypto";
import { addAllowedEmail } from "../../src/server/allowlist/allowlist";
import { createAuth } from "../../src/server/auth/auth";
import { loadConfig } from "../../src/server/config";
import { createDatabase } from "../../src/server/db/client";
import { createLogger } from "../../src/server/logging/logger";

/**
 * TEST-ONLY. Seeds an allowlisted user and a valid Better Auth session directly in the
 * database and returns the signed session cookie, for E2E and integration tests. It lives
 * under tests/ and is imported by no application code, so it is not reachable from the app.
 */
export async function seedAuthenticatedSession(options: {
  env: Record<string, string | undefined>;
  email: string;
  name?: string;
}) {
  const config = loadConfig(options.env);
  const { db, pool } = createDatabase(config.databaseUrl);
  try {
    const silent = createLogger({ minimumLevel: "error", write: () => {} });
    const auth = createAuth({ database: db, config, logger: silent });
    await addAllowedEmail(db, options.email);

    const context = await auth.$context;
    const user = await context.internalAdapter.createUser(
      {
        email: options.email.trim().toLowerCase(),
        name: options.name ?? "Test User",
        emailVerified: true,
      },
      { method: "oauth", oauth: { providerId: "google" } },
    );
    const session = await context.internalAdapter.createSession(user.id, false);

    const cookieName = context.authCookies.sessionToken.name;
    const signature = await makeSignature(session.token, config.authSecret);
    const cookieValue = encodeURIComponent(`${session.token}.${signature}`);
    return {
      userId: user.id,
      cookieName,
      cookieValue,
      cookieHeader: `${cookieName}=${cookieValue}`,
    };
  } finally {
    await pool.end();
  }
}
