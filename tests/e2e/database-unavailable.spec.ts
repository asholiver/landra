import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { makeSignature } from "better-auth/crypto";
import { E2E_AUTH_SECRET } from "./support/e2e-environment";
import { waitUntilOwnServerReady } from "./support/readiness";

// Spec failure behaviour: "Database unavailable: app routes show the error page with status 503,
// and the health check still answers." Each test starts its own server (own port, own version)
// whose DATABASE_URL points at a loopback port with nothing listening. It never points at a
// real database.
const root = resolve(import.meta.dirname, "../..");
const ORIGIN_OF_SERVER = (port: number) => `http://localhost:${port}`;

let server: ChildProcess;
let port = 0;
let version = "";
let sessionCookie = "";

/** An unused loopback port: it is released at once, so connections to it are refused. */
function closedPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port: found } = probe.address() as net.AddressInfo;
      probe.close(() => resolvePort(found));
    });
  });
}

test.beforeEach(async () => {
  const deadPort = await closedPort();
  port = await closedPort();
  version = `db-down-${randomUUID()}`;
  server = spawn(process.execPath, ["server/node-server.ts"], {
    cwd: root,
    env: {
      NODE_ENV: "test",
      PORT: String(port),
      GIT_SHA: version,
      DATABASE_URL: `postgresql://app:app@127.0.0.1:${deadPort}/unreachable`,
      BETTER_AUTH_SECRET: E2E_AUTH_SECRET,
      BETTER_AUTH_URL: ORIGIN_OF_SERVER(port),
    },
    stdio: "ignore",
  });
  await waitUntilOwnServerReady({
    baseUrl: ORIGIN_OF_SERVER(port),
    expectedVersion: version,
    hasExited: () => server.exitCode !== null,
    timeoutMs: 30_000,
  });
  // A correctly signed session cookie, so the server must consult the database to judge it
  // (an unsigned or absent cookie would be answered "signed out" without any lookup).
  const token = randomUUID();
  const signature = await makeSignature(token, E2E_AUTH_SECRET);
  sessionCookie = `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
});

test.afterEach(async () => {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((done) => server.once("exit", done));
  server.kill("SIGTERM");
  await exited;
});

function expectGenericUnavailablePage(status: number, body: string) {
  expect(status).toBe(503);
  expect(body).toContain("Temporarily unavailable");
  // Nothing from the signed-in shell, and no internals.
  expect(body).not.toContain("Sign out");
  expect(body).not.toContain("Your pipeline");
  expect(body).not.toContain("    at ");
  expect(body).not.toContain("file://");
  expect(body).not.toMatch(/ECONNREFUSED|postgres|Error:/i);
}

for (const path of ["/app", "/app/anything"]) {
  test(`${path} shows the generic 503 page when the database is down`, async () => {
    const response = await fetch(`${ORIGIN_OF_SERVER(port)}${path}`, {
      headers: { cookie: sessionCookie },
      redirect: "manual",
    });
    expectGenericUnavailablePage(response.status, await response.text());
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
}

test("/app data requests also fail with 503, not a redirect to sign-in", async () => {
  const response = await fetch(`${ORIGIN_OF_SERVER(port)}/app.data`, {
    headers: { cookie: sessionCookie },
    redirect: "manual",
  });
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

test("/healthz still answers 200 with its version while the database is down", async () => {
  const response = await fetch(`${ORIGIN_OF_SERVER(port)}/healthz`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", version });
});

// Control (M1): a ConfigError produces the same 503 as a database failure, so the 503 tests above
// could pass against a server with broken configuration. These only pass when getConfig()
// succeeded: the Origin check runs after it, and a cookie-less session lookup needs no database.
test("control: the server's configuration is valid (a foreign Origin gets 403, not 503)", async () => {
  const response = await fetch(`${ORIGIN_OF_SERVER(port)}/sign-out`, {
    method: "POST",
    headers: { cookie: sessionCookie, origin: "http://evil.example" },
    redirect: "manual",
  });
  expect(response.status).toBe(403);
  expect(response.headers.getSetCookie()).toEqual([]);
});

test("control: a request with no session cookie is answered 'signed out' without the database", async () => {
  const response = await fetch(`${ORIGIN_OF_SERVER(port)}/api/auth/get-session`);
  expect(response.status).toBe(200);
  expect(await response.json()).toBeNull();
});

test("sign-out fails closed (503, no redirect, no cookie cleared as if it worked)", async () => {
  const response = await fetch(`${ORIGIN_OF_SERVER(port)}/sign-out`, {
    method: "POST",
    headers: { cookie: sessionCookie, origin: ORIGIN_OF_SERVER(port) },
    redirect: "manual",
  });
  const body = await response.text();
  expect(response.status).toBe(503);
  expect(body).toBe("Sign-out is temporarily unavailable. Please try again.");
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.getSetCookie()).toEqual([]);
});
