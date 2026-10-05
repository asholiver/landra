import { describe, expect, it } from "vitest";
import { runWithRequestPolicy } from "../../src/server/http/request-policy";
import { createLogger } from "../../src/server/logging/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function setup() {
  const lines: string[] = [];
  const logger = createLogger({ write: (line) => lines.push(line) });
  const logged = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, logged, lines };
}

describe("runWithRequestPolicy", () => {
  it("adds security headers, a UUID request id and the nonce to the response", async () => {
    const { logger } = setup();
    let seenNonce = "";
    const response = await runWithRequestPolicy(
      new Request("http://localhost/app"),
      async (scope) => {
        seenNonce = scope.nonce;
        return new Response("ok");
      },
      { logger, sendContentSecurityPolicy: true },
    );
    expect(response.headers.get("X-Request-Id")).toMatch(UUID);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Content-Security-Policy")).toContain(`'nonce-${seenNonce}'`);
    expect(seenNonce.length).toBeGreaterThanOrEqual(16);
  });

  it("uses a fresh id and nonce per request and ignores an incoming X-Request-Id", async () => {
    const { logger } = setup();
    const scopes: Array<{ requestId: string; nonce: string }> = [];
    const run = () =>
      runWithRequestPolicy(
        new Request("http://localhost/", { headers: { "X-Request-Id": "attacker-chosen" } }),
        async (scope) => {
          scopes.push(scope);
          return new Response("ok");
        },
        { logger, sendContentSecurityPolicy: true },
      );
    const first = await run();
    const second = await run();
    expect(first.headers.get("X-Request-Id")).not.toBe("attacker-chosen");
    expect(scopes[0]?.requestId).not.toBe(scopes[1]?.requestId);
    expect(scopes[0]?.nonce).not.toBe(scopes[1]?.nonce);
    expect(second.headers.get("X-Request-Id")).toBe(scopes[1]?.requestId);
  });

  it("logs request id, method, route, status and duration, and never the query string (R11)", async () => {
    const { logger, logged, lines } = setup();
    let clock = 1000;
    await runWithRequestPolicy(
      new Request("http://localhost/api/auth/callback/google?code=SECRETCODE12345&state=abc", {
        method: "GET",
      }),
      async () => {
        clock += 42;
        return new Response(null, { status: 302 });
      },
      { logger, sendContentSecurityPolicy: true, now: () => clock },
    );
    const [entry] = logged();
    expect(entry).toMatchObject({
      method: "GET",
      route: "/api/auth/callback/google",
      status: 302,
      durationMs: 42,
      level: "info",
    });
    expect(entry?.requestId).toMatch(UUID);
    expect(lines.join("\n")).not.toContain("SECRETCODE");
  });

  it("works on a response whose headers are immutable (copies it)", async () => {
    const { logger } = setup();
    const immutable = Response.redirect("http://localhost/elsewhere", 302);
    const response = await runWithRequestPolicy(
      new Request("http://localhost/x"),
      async () => immutable,
      { logger, sendContentSecurityPolicy: true },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("http://localhost/elsewhere");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Request-Id")).toMatch(UUID);
  });

  it("logs a failure and rethrows it", async () => {
    const { logger, logged } = setup();
    await expect(
      runWithRequestPolicy(
        new Request("http://localhost/boom"),
        async () => {
          throw new Error("kaput");
        },
        { logger, sendContentSecurityPolicy: true },
      ),
    ).rejects.toThrow("kaput");
    expect(logged()[0]).toMatchObject({ level: "error", route: "/boom", status: 500 });
  });

  it("omits the CSP only when told to (dev server), keeping every other header", async () => {
    const { logger } = setup();
    const response = await runWithRequestPolicy(
      new Request("http://localhost/"),
      async () => new Response("ok"),
      { logger, sendContentSecurityPolicy: false },
    );
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });
});
