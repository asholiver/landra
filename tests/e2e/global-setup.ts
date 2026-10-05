import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runMigrations } from "../../src/server/db/migrate";
import {
  assertDisposableTarget,
  createRunDatabase,
  dropRunDatabase,
  testDatabaseUrl,
} from "../support/database";
import { assertPostgresReachable } from "../support/postgres-precheck";
import {
  E2E_BASE_URL,
  e2eServerEnvironment,
  RUN_DATABASE_ENV,
  SERVER_LOG_ENV,
} from "./support/e2e-environment";

const root = resolve(import.meta.dirname, "../..");
const STARTUP_TIMEOUT_MS = 30_000;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

/** Builds the standard Node server build, so E2E exercises what ships (never the dev server). */
function buildNodeServer() {
  const environment = { ...process.env };
  // A VERCEL variable would switch the build to the Vercel preset, which has no Node server.
  delete environment.VERCEL;
  execFileSync("pnpm", ["build"], { cwd: root, env: environment, stdio: "inherit" });
}

async function waitUntilHealthy(server: ChildProcess) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("The E2E web server exited during startup.");
    try {
      const response = await fetch(`${E2E_BASE_URL}/healthz`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error("The E2E web server did not become healthy in time.");
}

async function stopServer(server: ChildProcess) {
  if (server.exitCode !== null) return;
  const exited = new Promise((done) => server.once("exit", done));
  server.kill("SIGTERM");
  const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timer);
}

// Playwright globalSetup. Same disposable-database mechanism as the integration tests
// (tests/support/database.ts): safeguards first, one database per run, removed afterwards. The
// web server is started here, not by Playwright's `webServer`, because its database exists only
// once this setup has created it, and its configuration is passed explicitly.
export default async function globalSetup() {
  const { host, port } = assertDisposableTarget(testDatabaseUrl(), process.env);
  await assertPostgresReachable(host, port);

  buildNodeServer();

  const runUrl = await createRunDatabase();
  let server: ChildProcess | undefined;
  const logDirectory = mkdtempSync(join(tmpdir(), "e2e-server-"));
  const cleanUp = async () => {
    if (server) await stopServer(server);
    await dropRunDatabase().catch((error) => {
      console.warn(`Warning: could not remove the E2E database: ${describeError(error)}`);
    });
    rmSync(logDirectory, { recursive: true, force: true });
  };

  try {
    await runMigrations(runUrl, resolve(root, "drizzle"));

    const logFile = join(logDirectory, "server.log");
    const log = createWriteStream(logFile);
    // Explicit environment only: nothing ambient (no .env, no DATABASE_URL) reaches the server.
    server = spawn(process.execPath, ["server/node-server.ts"], {
      cwd: root,
      env: e2eServerEnvironment(runUrl),
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.pipe(log);
    server.stderr?.pipe(log);
    await waitUntilHealthy(server);

    process.env[RUN_DATABASE_ENV] = runUrl;
    process.env[SERVER_LOG_ENV] = logFile;
  } catch (error) {
    await cleanUp();
    throw error;
  }
  return cleanUp;
}
