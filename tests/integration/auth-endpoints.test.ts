import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { isGoogleTokenCallPath } from "../../src/server/auth/oauth-proxy-guard";
import { createTestRuntime } from "./helpers";

const runtime = createTestRuntime({
  GOOGLE_CLIENT_ID: "dummy-client-id",
  // Generated per run so no secret-shaped literal enters git history (gitleaks).
  OAUTH_PROXY_SECRET: randomBytes(32).toString("base64"),
  OAUTH_PROXY_PRODUCTION_URL: "https://app.example.com",
});
afterAll(() => runtime.pool.end());

/**
 * Every route the installed Better Auth exposes with this configuration, as reviewed against
 * better-auth 1.7.7 for F3. A route that can send the Google client secret to Google (a code
 * exchange or token refresh) must be in `isGoogleTokenCallPath` (src/server/auth/oauth-proxy-guard.ts)
 * so a proxy preview refuses it. When an upgrade adds a route, this test fails: review whether it
 * reaches Google's token endpoint, add it to the guard if so, then add it here.
 */
const REVIEWED_PATHS = new Set([
  "/ok",
  "/error",
  "/sign-in/social",
  "/sign-out",
  "/callback/:id",
  "/get-session",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/link-social",
  "/list-accounts",
  "/delete-user",
  "/delete-user/callback",
  "/unlink-account",
  "/refresh-token",
  "/get-access-token",
  "/account-info",
  "/update-user",
  "/update-session",
  "/change-email",
  // Password and email-verification routes: no Google token endpoint use (email/password is
  // disabled in this app anyway).
  "/change-password",
  "/request-password-reset",
  "/reset-password",
  "/reset-password/:token",
  "/send-verification-email",
  "/sign-in/email",
  "/sign-up/email",
  "/verify-email",
  "/verify-password",
  "/callback/:id/oauth-proxy",
  "/oauth-proxy-callback",
]);

describe("installed Better Auth routes (F3R-L2)", () => {
  const paths = Object.values(runtime.auth.api)
    .map((endpoint) => (endpoint as { path?: string }).path)
    .filter((path): path is string => typeof path === "string");

  it("exposes only routes that were reviewed for Google token-endpoint use", () => {
    const unreviewed = paths.filter((path) => !REVIEWED_PATHS.has(path)).sort();
    expect(unreviewed).toEqual([]);
  });

  it("guards the routes known to reach Google's token endpoint", () => {
    for (const path of ["/callback/:id", "/refresh-token", "/get-access-token", "/account-info"]) {
      expect(paths).toContain(path);
      expect(isGoogleTokenCallPath(path)).toBe(true);
    }
  });
});
