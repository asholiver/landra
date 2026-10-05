import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { SIGN_IN_START_RATE_LIMIT } from "../../src/server/auth/auth";
import { RUN_DATABASE_ENV } from "./support/e2e-environment";
import { waitUntilOwnServerReady } from "./support/readiness";

// Black-box check of the sign-in start rate limit on the real Node server in production mode
// (Better Auth only rate limits in production), with dummy Google credentials and no network:
//  - the limit applies (the request after the configured maximum is 429);
//  - a client cannot get a fresh bucket by sending its own X-Forwarded-For / X-Real-IP.
// Not verifiable here: how Vercel populates x-forwarded-for (a Stage 2 check).
const root = resolve(import.meta.dirname, "../..");
const PORT = 4176;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VERSION = "rate-limit-test";
const TRUSTED_ORIGIN = "https://sign-in.rate-limit.invalid";

test.describe.configure({ mode: "serial" });

let server: ChildProcess;

test.beforeAll(async () => {
  const databaseUrl = process.env[RUN_DATABASE_ENV];
  if (!databaseUrl) throw new Error("The E2E global setup did not run.");
  server = spawn(process.execPath, ["server/node-server.ts"], {
    cwd: root,
    // Explicit, non-secret values; production needs https and Google credentials.
    env: {
      NODE_ENV: "production",
      PORT: String(PORT),
      GIT_SHA: VERSION,
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: "k3Jd9sLq0Zx7VbN2mWc8RtYf5HgA1PeU",
      BETTER_AUTH_URL: TRUSTED_ORIGIN,
      GOOGLE_CLIENT_ID: "dummy-client-id.apps.invalid",
      GOOGLE_CLIENT_SECRET: "dummy-client-secret-value",
    },
    stdio: "ignore",
  });
  await waitUntilOwnServerReady({
    baseUrl: BASE_URL,
    expectedVersion: VERSION,
    hasExited: () => server.exitCode !== null,
    timeoutMs: 30_000,
  });
});

test.afterAll(async () => {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((done) => server.once("exit", done));
  server.kill("SIGTERM");
  await exited;
});

function startSignIn(extraHeaders: Record<string, string> = {}) {
  return fetch(`${BASE_URL}/sign-in/google`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: TRUSTED_ORIGIN,
      ...extraHeaders,
    },
    body: "returnTo=%2Fapp",
  });
}

test("the limit applies, and client-supplied forwarding headers do not give a fresh bucket", async () => {
  for (let attempt = 1; attempt <= SIGN_IN_START_RATE_LIMIT.max; attempt += 1) {
    const response = await startSignIn();
    expect(response.status, `attempt ${attempt}`).toBe(302);
    expect(response.headers.get("location")).toContain("https://accounts.google.com/");
  }
  expect((await startSignIn()).status).toBe(429);

  // Spoofing attempts: each request claims to be a different client.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const spoofed = await startSignIn({
      "x-forwarded-for": `198.51.100.${attempt + 1}`,
      "x-real-ip": `198.51.100.${attempt + 100}`,
      "x-client-ip": `198.51.100.${attempt + 200}`,
      forwarded: `for=198.51.100.${attempt + 50}`,
    });
    expect(spoofed.status, `spoof ${attempt + 1}`).toBe(429);
  }
});
