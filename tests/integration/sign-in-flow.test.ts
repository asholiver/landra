import { afterAll, describe, expect, it } from "vitest";
import { SIGN_IN_ERROR_CODES, startGoogleSignIn } from "../../src/server/auth/sign-in-flow";
import { verification } from "../../src/server/db/schema";
import { createLogger } from "../../src/server/logging/logger";
import { createTestRuntime } from "./helpers";

// Throwaway, non-secret Google client values: the flow only builds Google's authorisation URL;
// nothing here ever contacts Google.
const googleEnvironment = {
  GOOGLE_CLIENT_ID: "test-client-id.apps.example.invalid",
  GOOGLE_CLIENT_SECRET: "test-client-secret-value",
};

const configured = createTestRuntime(googleEnvironment);
const unconfigured = createTestRuntime();
afterAll(async () => {
  await configured.pool.end();
  await unconfigured.pool.end();
});

const silentLogger = createLogger({ minimumLevel: "error", write: () => {} });

async function start(returnTo: string | null) {
  return startGoogleSignIn({
    auth: configured.auth,
    config: configured.config,
    logger: silentLogger,
    returnTo,
  });
}

describe("startGoogleSignIn", () => {
  it("redirects to Google's authorisation URL and sets the state cookie", async () => {
    const result = await start("/app");
    expect(result.kind).toBe("redirect");
    if (result.kind !== "redirect") return;
    const location = new URL(result.location);
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("client_id")).toBe(googleEnvironment.GOOGLE_CLIENT_ID);
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost:5173/api/auth/callback/google",
    );
    expect(result.headers.get("set-cookie")).toBeTruthy();
  });

  it("reports not-configured, with no redirect, when Google credentials are absent", async () => {
    const result = await startGoogleSignIn({
      auth: unconfigured.auth,
      config: unconfigured.config,
      logger: silentLogger,
      returnTo: "/app",
    });
    expect(result).toEqual({ kind: "error", code: SIGN_IN_ERROR_CODES.notConfigured });
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/.//evil.example",
  ])("never accepts the off-origin return path %j", async (returnTo) => {
    const result = await start(returnTo);
    // Sanitised to the default, so sign-in still starts, and the stored callback is /app.
    expect(result.kind).toBe("redirect");
    const states = await configured.db.select().from(verification);
    const serialised = JSON.stringify(states.map((row) => row.value));
    expect(serialised).not.toContain("evil.example");
    expect(serialised).not.toContain("javascript:");
  });
});
