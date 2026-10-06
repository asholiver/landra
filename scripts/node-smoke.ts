import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { resolve } from "node:path";
import { securityHeaders } from "../src/server/http/security-headers.ts";

// `pnpm smoke:node` (R18, AC10): builds the standard Node build, starts it exactly as documented
// (`pnpm start`, which runs server/node-server.ts through Node's TypeScript type stripping) and
// checks that `/` and `/healthz` answer 200 with the shared security headers.
//
// It protects the constraints of running TypeScript directly: a non-erasable construct (enum,
// parameter property, namespace) or an extensionless import in the type-stripped files makes the
// server exit at startup, which this script reports with the server's own output.
//
// The server gets an explicit, non-secret environment (nothing ambient: no .env, no real
// DATABASE_URL). `/` is a prerendered file and `/healthz` makes no database call, so the database
// URL below is never connected to.
const root = resolve(import.meta.dirname, "..");
const STARTUP_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;
const OUTPUT_TAIL_CHARACTERS = 4000;

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => (port ? resolvePort(port) : reject(new Error("no free port found"))));
    });
  });
}

function sleep(milliseconds: number) {
  return new Promise((done) => setTimeout(done, milliseconds));
}

function fail(message: string, serverOutput: () => string): never {
  console.error(`Node smoke test FAILED: ${message}`);
  const output = serverOutput().trim();
  if (output) console.error(`--- server output (last part) ---\n${output}\n--- end ---`);
  process.exitCode = 1;
  throw new Error(message);
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null || !server.pid) return;
  const exited = new Promise<void>((done) => server.once("exit", () => done()));
  // The server is the leader of its own process group (pnpm and node), so one signal reaches both.
  process.kill(-server.pid, "SIGTERM");
  const outcome = await Promise.race([
    exited.then(() => "exited" as const),
    sleep(SHUTDOWN_TIMEOUT_MS).then(() => "timeout" as const),
  ]);
  if (outcome === "timeout") {
    process.kill(-server.pid, "SIGKILL");
    await exited;
    throw new Error("the server did not stop within the shutdown timeout and was killed");
  }
}

function checkHeaders(label: string, response: Response, expected: Record<string, string>) {
  const problems: string[] = [];
  for (const [name, value] of Object.entries(expected)) {
    const actual = response.headers.get(name);
    if (actual === null) problems.push(`${name} is missing`);
    else if (name === "Content-Security-Policy") {
      // Dynamic responses add a per-request nonce to script-src; compare without it.
      const withoutNonce = actual.replace(/ 'nonce-[^']+'/g, "");
      if (withoutNonce !== value) problems.push(`${name} differs from the shared policy`);
    } else if (actual !== value) problems.push(`${name} differs from the shared value`);
  }
  return problems.map((problem) => `${label}: ${problem}`);
}

// A VERCEL variable would switch the build to the Vercel preset, which has no Node server.
const buildEnvironment = { ...process.env };
delete buildEnvironment.VERCEL;
execFileSync("pnpm", ["build"], { cwd: root, env: buildEnvironment, stdio: "inherit" });

const port = await freePort();
const version = `smoke-${randomUUID()}`;
const baseUrl = `http://127.0.0.1:${port}`;

const serverEnvironment: Record<string, string> = {
  // Only what is needed to find and run pnpm and node.
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  // Explicit, non-secret configuration (the same approach as the E2E server).
  NODE_ENV: "test",
  PORT: String(port),
  DATABASE_URL: "postgresql://app:app@127.0.0.1:1/unused",
  BETTER_AUTH_SECRET: "smoke-throwaway-value-0123456789-abcdefghijkl",
  BETTER_AUTH_URL: baseUrl,
  GIT_SHA: version,
};

let outputTail = "";
const server = spawn("pnpm", ["start"], {
  cwd: root,
  env: serverEnvironment,
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
const remember = (chunk: Buffer) => {
  outputTail = (outputTail + chunk.toString()).slice(-OUTPUT_TAIL_CHARACTERS);
};
server.stdout?.on("data", remember);
server.stderr?.on("data", remember);
const serverOutput = () => outputTail;

try {
  // Wait for this run's own server: /healthz must report this run's random version.
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let ready = false;
  while (!ready) {
    if (server.exitCode !== null || server.signalCode !== null) {
      fail(
        `the server exited during startup (exit code ${server.exitCode}, signal ${server.signalCode}). ` +
          "Check for a non-erasable TypeScript construct or an extensionless import in the files Node runs directly.",
        serverOutput,
      );
    }
    if (Date.now() > deadline) fail("the server did not report its version in time", serverOutput);
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      const body = (await response.json()) as { status?: unknown; version?: unknown };
      ready = response.ok && body.status === "ok" && body.version === version;
    } catch {
      // Not listening yet.
    }
    if (!ready) await sleep(200);
  }

  const expected = securityHeaders();
  const problems: string[] = [];
  for (const path of ["/", "/healthz"]) {
    const response = await fetch(`${baseUrl}${path}`);
    if (response.status !== 200)
      problems.push(`${path}: expected status 200, got ${response.status}`);
    problems.push(...checkHeaders(path, response, expected));
    await response.arrayBuffer();
  }
  if (problems.length > 0) fail(problems.join("\n"), serverOutput);
  console.log(
    `Node smoke test passed: / and /healthz returned 200 with the shared headers (${baseUrl}).`,
  );
} finally {
  try {
    await stopServer(server);
  } catch (error) {
    console.error(
      `Node smoke test FAILED: ${error instanceof Error ? error.message : "stop failed"}`,
    );
    process.exitCode = 1;
  }
}
