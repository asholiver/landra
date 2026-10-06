import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { waitUntilOwnServerReady } from "./support/readiness";

// The Node server must not send stack traces to clients unless NODE_ENV is explicitly
// "development". A throwaway server per NODE_ENV value is started on its own port, with an
// explicit environment that has NO application configuration, so the auth endpoint hits an
// unhandled error (invalid configuration) inside its loader.
const root = resolve(import.meta.dirname, "../..");
const PORT = 4175;
const VERSION = "server-mode-test";

const NODE_ENV_CASES: Array<{ label: string; value: string | undefined }> = [
  { label: "unset", value: undefined },
  { label: "empty", value: "" },
  { label: "test", value: "test" },
  { label: "production", value: "production" },
];

async function stop(server: ChildProcess) {
  if (server.exitCode !== null) return;
  const exited = new Promise((done) => server.once("exit", done));
  server.kill("SIGTERM");
  await exited;
}

// One server at a time on a fixed port.
test.describe.configure({ mode: "serial" });

for (const { label, value } of NODE_ENV_CASES) {
  test(`an unhandled error never exposes a stack trace (NODE_ENV ${label})`, async () => {
    const environment: Record<string, string> = { PORT: String(PORT), GIT_SHA: VERSION };
    if (value !== undefined) environment.NODE_ENV = value;
    const server = spawn(process.execPath, ["server/node-server.ts"], {
      cwd: root,
      env: environment,
      stdio: "ignore",
    });
    try {
      await waitUntilOwnServerReady({
        baseUrl: `http://localhost:${PORT}`,
        expectedVersion: VERSION,
        hasExited: () => server.exitCode !== null,
        timeoutMs: 30_000,
      });
      const response = await fetch(`http://localhost:${PORT}/api/auth/get-session`);
      const body = await response.text();
      expect(response.status).toBe(500);
      expect(body).toContain("Unexpected Server Error");
      expect(body).not.toContain("    at ");
      expect(body).not.toContain("file://");
      expect(body).not.toContain("ConfigError");
    } finally {
      await stop(server);
    }
  });
}
