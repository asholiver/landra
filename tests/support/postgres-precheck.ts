import net from "node:net";

export function unreachableMessage(host: string, port: number): string {
  return `Test PostgreSQL is not reachable at ${host}:${port} — run \`docker compose up -d postgres-test\``;
}

/** Lightweight TCP check so a stopped database gives one clear error, not obscure test failures. */
export function assertPostgresReachable(
  host: string,
  port: number,
  timeoutMs = 3000,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = net.connect({ host, port });
    const fail = () => {
      socket.destroy();
      rejectPromise(new Error(unreachableMessage(host, port)));
    };
    socket.setTimeout(timeoutMs, fail);
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.destroy();
      resolvePromise();
    });
  });
}
