import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { symmetricEncrypt } from "better-auth/crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { account, allowedEmail, session, user } from "../../src/server/db/schema";
import { seedAuthenticatedSession } from "../support/session";
import { createTestRuntime, testEnvironment } from "./helpers";

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
// A proxy preview holds no Google client secret (F3); config rejects one on a proxy preview.
const previewOverrides = {
  ...shared,
  GOOGLE_CLIENT_SECRET: "",
  BETTER_AUTH_URL: "https://preview.example.com",
};
const preview = createTestRuntime(previewOverrides);
// L-B: the platform says "production" although the URLs do not match: fail closed.
const platformProduction = createTestRuntime({
  ...shared,
  BETTER_AUTH_URL: "https://preview.example.com",
  VERCEL_ENV: "production",
});
const platformPreview = createTestRuntime({ ...previewOverrides, VERCEL_ENV: "preview" });
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

// F3: a proxy preview holds only the Google client ID. Production alone exchanges the code.
describe("proxy preview without the Google client secret (F3)", () => {
  const secretless = createTestRuntime({ ...previewOverrides, VERCEL_ENV: "preview" });
  afterAll(async () => {
    await secretless.pool.end();
  });
  const PREVIEW = "https://preview.example.com";
  const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

  /** Records every outbound fetch and fails it, so nothing reaches Google. */
  async function withFetchRecorded<T>(
    run: () => Promise<T>,
  ): Promise<{ result: T; outbound: string[] }> {
    const outbound: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      outbound.push(String(args[0] instanceof Request ? args[0].url : args[0]));
      throw new Error("no outbound request is expected");
    }) as typeof fetch;
    try {
      return { result: await run(), outbound };
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  async function seedSessionWithExpiredGoogleToken() {
    const env = { ...testEnvironment(), ...previewOverrides, VERCEL_ENV: "preview" };
    const seeded = await seedAuthenticatedSession({ env, email: "owner@example.com" });
    await secretless.db.insert(account).values({
      id: "google-account-row",
      accountId: "google-sub-1",
      providerId: "google",
      userId: seeded.userId,
      accessToken: "expired-access-token",
      refreshToken: "refresh-token",
      accessTokenExpiresAt: new Date(Date.now() - 60_000),
    });
    return seeded;
  }

  beforeEach(async () => {
    await secretless.db.delete(session);
    await secretless.db.delete(account);
    await secretless.db.delete(user);
    await secretless.db.delete(allowedEmail);
  });

  it("holds no secret and registers the provider", () => {
    expect(secretless.config.google).toEqual({ clientId: "dummy-client-id", clientSecret: null });
  });

  it("starts the sign-in through production without sending any secret to Google", async () => {
    const response = await secretless.auth.handler(
      new Request("https://preview.example.com/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://preview.example.com" },
        body: JSON.stringify({
          provider: "google",
          callbackURL: "/app",
          disableRedirect: true,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };
    const googleUrl = new URL(url);
    expect(googleUrl.origin).toBe("https://accounts.google.com");
    expect(googleUrl.searchParams.get("client_id")).toBe("dummy-client-id");
    // The code must come back to production, never to this preview.
    expect(googleUrl.searchParams.get("redirect_uri")).toBe(
      `${PRODUCTION_URL}/api/auth/callback/google`,
    );
    expect(googleUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(googleUrl.searchParams.has("client_secret")).toBe(false);
    expect(url).not.toContain("unused-on-proxy-preview");
    expect(response.headers.getSetCookie().join(";")).not.toContain("unused-on-proxy-preview");
  });

  it("refuses a code callback carrying a genuine state and cookies, and never calls Google", async () => {
    // A real sign-in start, so the callback has valid state: without the guard the plugin and
    // the callback route would exchange the code at Google's token endpoint.
    const start = await secretless.auth.handler(
      new Request(`${PREVIEW}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: PREVIEW },
        body: JSON.stringify({ provider: "google", callbackURL: "/app", disableRedirect: true }),
      }),
    );
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state") ?? "";
    const cookies = start.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
    expect(state).not.toBe("");

    const { result, outbound } = await withFetchRecorded(() =>
      secretless.auth.handler(
        new Request(
          `${PREVIEW}/api/auth/callback/google?code=abc&state=${encodeURIComponent(state)}`,
          {
            headers: { origin: PREVIEW, cookie: cookies },
          },
        ),
      ),
    );
    expect(outbound).toEqual([]);
    expect(result.status).toBe(404);
  });

  it.each([
    ["POST", "/get-access-token"],
    ["POST", "/refresh-token"],
    ["GET", "/account-info"],
  ] as const)(
    "refuses %s %s for a signed-in user with an expired Google token and never calls Google",
    async (method, path) => {
      const seeded = await seedSessionWithExpiredGoogleToken();
      const { result, outbound } = await withFetchRecorded(() =>
        secretless.auth.handler(
          new Request(
            `${PREVIEW}/api/auth${path}${method === "GET" ? "?accountId=google-account-row" : ""}`,
            {
              method,
              headers: {
                origin: PREVIEW,
                cookie: seeded.cookieHeader,
                "content-type": "application/json",
              },
              body:
                method === "POST" ? JSON.stringify({ accountId: "google-account-row" }) : undefined,
            },
          ),
        ),
      );
      expect(outbound.filter((target) => target.startsWith(TOKEN_ENDPOINT))).toEqual([]);
      expect(outbound).toEqual([]);
      expect(result.status).toBe(404);
    },
  );

  it("control: a deployment that holds the secret does not refuse these routes", async () => {
    const response = await production.auth.handler(
      new Request(`${PRODUCTION_URL}/api/auth/callback/google?code=abc&state=xyz`, {
        headers: { origin: PRODUCTION_URL },
      }),
    );
    expect(response.status).not.toBe(404);
  });

  it("still completes a proxied sign-in profile (the secretless preview does not need the secret)", async () => {
    const response = await secretless.auth.handler(
      await completionRequest("https://preview.example.com", "/callback/google/oauth-proxy"),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location") ?? "").toContain("state_mismatch");
  });
});
