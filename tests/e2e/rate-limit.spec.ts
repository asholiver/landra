import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { RUN_DATABASE_ENV } from "./support/e2e-environment";
import { waitUntilOwnServerReady } from "./support/readiness";

// Black-box check of the sign-in start rate limit on the real Node server in production mode
// (Better Auth only rate limits in production), with dummy Google credentials and no network:
//  - the limit applies (the request after the configured maximum is 429);
//  - a client cannot get a fresh bucket by sending its own X-Forwarded-For / X-Real-IP.
// Not verifiable here: how Vercel populates x-forwarded-for (a Stage 2 check).
const root = resolve(import.meta.dirname, "../..");
// Better Auth's built-in limit for every "/sign-in*" path: 3 requests per 10 seconds.
const SIGN_IN_START_LIMIT = 3;
const TRUSTED_ORIGIN = "https://sign-in.rate-limit.invalid";

let server: ChildProcess;
let baseUrl = "";

/** An unused port, so parallel and repeated runs never share a server or its limiter state. */
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolvePort(port));
    });
  });
}

// A fresh server (so an empty in-memory limiter) for every test run, including repeats.
test.beforeEach(async () => {
  const databaseUrl = process.env[RUN_DATABASE_ENV];
  if (!databaseUrl) throw new Error("The E2E global setup did not run.");
  const port = await freePort();
  const version = `rate-limit-${randomUUID()}`;
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["server/node-server.ts"], {
    cwd: root,
    // Explicit, non-secret values; production needs https and Google credentials.
    env: {
      NODE_ENV: "production",
      PORT: String(port),
      GIT_SHA: version,
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: "k3Jd9sLq0Zx7VbN2mWc8RtYf5HgA1PeU",
      BETTER_AUTH_URL: TRUSTED_ORIGIN,
      GOOGLE_CLIENT_ID: "dummy-client-id.apps.invalid",
      GOOGLE_CLIENT_SECRET: "dummy-client-secret-value",
    },
    stdio: "ignore",
  });
  await waitUntilOwnServerReady({
    baseUrl,
    expectedVersion: version,
    hasExited: () => server.exitCode !== null,
    timeoutMs: 30_000,
  });
});

test.afterEach(async () => {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((done) => server.once("exit", done));
  server.kill("SIGTERM");
  await exited;
});

function startSignIn(extraHeaders: Record<string, string> = {}) {
  return fetch(`${baseUrl}/sign-in/google`, {
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
  for (let attempt = 1; attempt <= SIGN_IN_START_LIMIT; attempt += 1) {
    const response = await startSignIn();
    expect(response.status, `attempt ${attempt}`).toBe(302);
    expect(response.headers.get("location")).toContain("https://accounts.google.com/");
  }
  expect((await startSignIn()).status).toBe(429);

  // Spoofing attempts: each request claims to be a different client.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const spoofed = await startSignIn({
      // Single-value and multi-value chains, both of which must be ignored by the server.
      "x-forwarded-for":
        attempt % 2 === 0
          ? `198.51.100.${attempt + 1}`
          : `198.51.100.${attempt + 1}, 192.0.2.${attempt + 1}`,
      "x-real-ip": `198.51.100.${attempt + 100}`,
      "x-client-ip": `198.51.100.${attempt + 200}`,
      forwarded: `for=198.51.100.${attempt + 50}`,
    });
    expect(spoofed.status, `spoof ${attempt + 1}`).toBe(429);
  }
});
