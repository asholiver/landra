import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { symmetricEncrypt } from "better-auth/crypto";
import { afterAll, describe, expect, it } from "vitest";
import { account, session, user } from "../../src/server/db/schema";
import { createTestRuntime } from "./helpers";

// Random-looking: production config rejects weak or placeholder secrets.
const PROXY_SECRET = "Hk3Vb8Wz1Xn6Mq9Sd2Lt7Cr4Yf0Ge5Pj+UaOiNxBvTs=";
const PRODUCTION_URL = "https://app.example.com";

const shared = {
  NODE_ENV: "production",
  BETTER_AUTH_SECRET: "q7Lr2mX9vB4nT8wK1sZ5cD0hJ6gF3yPaUe+RoNi/AdE=",
  GOOGLE_CLIENT_ID: "dummy-client-id",
  GOOGLE_CLIENT_SECRET: "dummy-client-secret",
  OAUTH_PROXY_SECRET: PROXY_SECRET,
  OAUTH_PROXY_PRODUCTION_URL: PRODUCTION_URL,
};
const production = createTestRuntime({ ...shared, BETTER_AUTH_URL: PRODUCTION_URL });
const preview = createTestRuntime({ ...shared, BETTER_AUTH_URL: "https://preview.example.com" });
// L-B: the platform says "production" although the URLs do not match: fail closed.
const platformProduction = createTestRuntime({
  ...shared,
  BETTER_AUTH_URL: "https://preview.example.com",
  VERCEL_ENV: "production",
});
const platformPreview = createTestRuntime({
  ...shared,
  BETTER_AUTH_URL: "https://preview.example.com",
  VERCEL_ENV: "preview",
});
afterAll(async () => {
  await production.pool.end();
  await preview.pool.end();
  await platformProduction.pool.end();
  await platformPreview.pool.end();
});

// The plugin's own key derivation is not part of better-auth's public exports, so load the
// exact helper the plugin uses from the installed package.
async function encryptedProfile(): Promise<string> {
  const packageDirectory = resolve(import.meta.dirname, "../../node_modules/better-auth");
  const { derivePurposeKey } = (await import(
    pathToFileURL(join(packageDirectory, "dist/crypto/purpose.mjs")).href
  )) as { derivePurposeKey: (secret: string, purpose: string) => string };
  const payload = {
    userInfo: {
      id: "google-sub-1",
      email: "owner@example.com",
      emailVerified: true,
      name: "Owner",
    },
    account: { accountId: "google-sub-1", providerId: "google" },
    state: "not-a-real-state",
    callbackURL: "http://localhost:5173/app",
    timestamp: Date.now(),
  };
  return symmetricEncrypt({
    key: derivePurposeKey(PROXY_SECRET, "oauth-proxy-profile"),
    data: JSON.stringify(payload),
  });
}

async function completionRequest(baseUrl: string, path: string) {
  const query = new URLSearchParams({
    callbackURL: "http://localhost:5173/app",
    profile: await encryptedProfile(),
  });
  return new Request(`${baseUrl}/api/auth${path}?${query}`, { headers: { origin: baseUrl } });
}

async function rowCounts(runtime: typeof production) {
  const count = async (table: typeof user | typeof session | typeof account) =>
    (await runtime.db.select().from(table)).length;
  return {
    users: await count(user),
    sessions: await count(session),
    accounts: await count(account),
  };
}

describe("OAuth Proxy completion endpoints (HIGH-4)", () => {
  it.each(["/callback/google/oauth-proxy", "/oauth-proxy-callback"])(
    "production refuses %s even with a valid encrypted payload, creating no rows",
    async (path) => {
      const before = await rowCounts(production);
      const response = await production.auth.handler(await completionRequest(PRODUCTION_URL, path));
      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await rowCounts(production)).toEqual(before);
    },
  );

  it.each(["/callback/google/oauth-proxy", "/oauth-proxy-callback"])(
    "VERCEL_ENV=production refuses %s even when the URL origins differ",
    async (path) => {
      const before = await rowCounts(platformProduction);
      const response = await platformProduction.auth.handler(
        await completionRequest("https://preview.example.com", path),
      );
      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await rowCounts(platformProduction)).toEqual(before);
    },
  );

  it("VERCEL_ENV=preview does not block: the request reaches the plugin", async () => {
    const response = await platformPreview.auth.handler(
      await completionRequest("https://preview.example.com", "/callback/google/oauth-proxy"),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location") ?? "").toContain("state_mismatch");
  });

  it("a preview deployment is not blocked by the guard: the request reaches the plugin", async () => {
    const response = await preview.auth.handler(
      await completionRequest("https://preview.example.com", "/callback/google/oauth-proxy"),
    );
    // The plugin decrypted the payload and then rejected the unknown state with a redirect.
    expect(response.status).toBe(302);
    expect(response.headers.get("location") ?? "").toContain("state_mismatch");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
