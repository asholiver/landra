import net from "node:net";

/**
 * True only if a /healthz response body comes from the server this run started: it must report
 * the run's own random version. Anything else answering on the port is not ours.
 */
export function isOwnServerReady(body: unknown, expectedVersion: string): boolean {
  if (typeof body !== "object" || body === null) return false;
  const { status, version } = body as { status?: unknown; version?: unknown };
  return status === "ok" && version === expectedVersion;
}

/** Rejects with a clear message if something already accepts connections on the port. */
export function assertPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host: "localhost" });
    socket.once("connect", () => {
      socket.destroy();
      reject(
        new Error(
          `Port ${port} is already in use. Stop whatever is listening there (a leftover server?) and retry.`,
        ),
      );
    });
    socket.once("error", () => {
      socket.destroy();
      resolve();
    });
  });
}

/** Polls /healthz until the run's own server answers, the process dies, or time runs out. */
export async function waitUntilOwnServerReady(options: {
  baseUrl: string;
  expectedVersion: string;
  hasExited: () => boolean;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    if (options.hasExited()) throw new Error("The E2E web server exited during startup.");
    try {
      const response = await fetch(`${options.baseUrl}/healthz`);
      if (response.ok && isOwnServerReady(await response.json(), options.expectedVersion)) return;
    } catch {
      // Not listening yet, or not JSON.
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error("The E2E web server did not become ready in time.");
}
