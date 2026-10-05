import { afterAll, describe, expect, it } from "vitest";
import { createAuth, SIGN_IN_START_RATE_LIMIT } from "../../src/server/auth/auth";
import {
  handleGoogleSignIn,
  MAX_SIGN_IN_BODY_BYTES,
  SIGN_IN_ERROR_CODES,
} from "../../src/server/auth/sign-in-flow";
import { loadConfig } from "../../src/server/config";
import { createDatabase } from "../../src/server/db/client";
import { verification } from "../../src/server/db/schema";
import { createLogger } from "../../src/server/logging/logger";
import { testEnvironment } from "./helpers";

// Throwaway, non-secret Google client values: the flow only builds Google's authorisation URL;
// nothing here ever contacts Google.
const googleEnvironment = {
  GOOGLE_CLIENT_ID: "test-client-id.apps.example.invalid",
  GOOGLE_CLIENT_SECRET: "test-client-secret-value",
};
const ORIGIN = "http://localhost:5173";
const silentLogger = createLogger({ minimumLevel: "error", write: () => {} });

function runtime(extraEnvironment: Record<string, string>) {
  const config = loadConfig({ ...testEnvironment(), ...extraEnvironment });
  const { db, pool } = createDatabase(config.databaseUrl);
  // Rate limiting is forced on: Better Auth only enables it in production by default.
  const auth = createAuth({ database: db, config, logger: silentLogger, rateLimitEnabled: true });
  return { config, db, pool, auth };
}

const configured = runtime(googleEnvironment);
const unconfigured = runtime({});
afterAll(async () => {
  await configured.pool.end();
  await unconfigured.pool.end();
});

let clientCounter = 0;
/** A distinct client address per test, so rate-limit buckets never interfere. */
const newClientAddress = () => `203.0.113.${++clientCounter}`;

function post(options: {
  client?: string;
  origin?: string | null;
  returnTo?: string;
  body?: string;
  headers?: Record<string, string>;
}) {
  const body =
    options.body ?? new URLSearchParams({ returnTo: options.returnTo ?? "/app" }).toString();
  const headers = new Headers({
    "content-type": "application/x-www-form-urlencoded",
    "content-length": String(new TextEncoder().encode(body).byteLength),
    "x-forwarded-for": options.client ?? newClientAddress(),
    ...options.headers,
  });
  if (options.origin !== null) headers.set("origin", options.origin ?? ORIGIN);
  return new Request(`${ORIGIN}/sign-in/google`, { method: "POST", headers, body });
}

const start = (request: Request, runtimeToUse = configured) =>
  handleGoogleSignIn({
    request,
    auth: runtimeToUse.auth,
    config: runtimeToUse.config,
    logger: silentLogger,
  });

describe("handleGoogleSignIn", () => {
  it("redirects to Google's authorisation URL and forwards the state cookies", async () => {
    const response = await start(post({}));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("client_id")).toBe(googleEnvironment.GOOGLE_CLIENT_ID);
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback/google`);
    const cookies = response.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    expect(cookies.some((cookie) => /state/i.test(cookie))).toBe(true);
  });

  it("reports not-configured, with no redirect to a provider, when Google is absent", async () => {
    const response = await start(post({}), unconfigured);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `/sign-in?error=${SIGN_IN_ERROR_CODES.notConfigured}`,
    );
  });

  it("refuses an untrusted or missing Origin with 403", async () => {
    expect((await start(post({ origin: "https://evil.example" }))).status).toBe(403);
    expect((await start(post({ origin: null }))).status).toBe(403);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/.//evil.example",
  ])("never stores the off-origin return path %j", async (returnTo) => {
    const response = await start(post({ returnTo }));
    expect(response.status).toBe(302);
    const states = await configured.db.select().from(verification);
    const serialised = JSON.stringify(states.map((row) => row.value));
    expect(serialised).not.toContain("evil.example");
    expect(serialised).not.toContain("javascript:");
  });

  describe("body limit (413 before parsing)", () => {
    it("rejects a 1 MB body", async () => {
      const response = await start(post({ body: `returnTo=${"a".repeat(1_000_000)}` }));
      expect(response.status).toBe(413);
    });

    it("rejects a body just over the cap and accepts one at the cap", async () => {
      const filler = (total: number) => `returnTo=/${"a".repeat(total - "returnTo=/".length)}`;
      expect((await start(post({ body: filler(MAX_SIGN_IN_BODY_BYTES + 1) }))).status).toBe(413);
      expect((await start(post({ body: filler(MAX_SIGN_IN_BODY_BYTES) }))).status).toBe(302);
    });

    it("rejects a missing or invalid Content-Length", async () => {
      for (const length of [undefined, "abc", "-1", "99999999999"]) {
        const request = post({ body: "returnTo=/app" });
        if (length === undefined) request.headers.delete("content-length");
        else request.headers.set("content-length", length);
        expect((await start(request)).status, String(length)).toBe(413);
      }
    });

    it("cuts off a streamed body that is larger than it declared", async () => {
      const oversized = new TextEncoder().encode(`returnTo=${"a".repeat(100_000)}`);
      const request = new Request(`${ORIGIN}/sign-in/google`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "content-length": "20",
          origin: ORIGIN,
          "x-forwarded-for": newClientAddress(),
        },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(oversized);
            controller.close();
          },
        }),
        // @ts-expect-error Node's fetch requires duplex for streamed request bodies
        duplex: "half",
      });
      expect((await start(request)).status).toBe(413);
    });
  });

  describe("rate limiting (Better Auth's own limiter)", () => {
    it("returns 429 on the request after the configured limit, per client", async () => {
      const client = newClientAddress();
      for (let attempt = 0; attempt < SIGN_IN_START_RATE_LIMIT.max; attempt += 1) {
        expect((await start(post({ client }))).status, `attempt ${attempt + 1}`).toBe(302);
      }
      const limited = await start(post({ client }));
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

      // A different client is unaffected.
      expect((await start(post({}))).status).toBe(302);
    });
  });
});
