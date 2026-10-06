import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/server/logging/logger";

function capture() {
  const lines: string[] = [];
  return { lines, logger: createLogger({ write: (line) => lines.push(line) }) };
}

describe("logger (R11)", () => {
  it("writes one JSON object per line with level, time and message", () => {
    const { lines, logger } = capture();
    logger.info("hello", { route: "/healthz", status: 200 });
    const entry = JSON.parse(lines[0] ?? "");
    expect(entry).toMatchObject({
      level: "info",
      message: "hello",
      route: "/healthz",
      status: 200,
    });
    expect(typeof entry.time).toBe("string");
  });

  it("redacts tokens, cookies, secrets and authorization, including nested", () => {
    const { lines, logger } = capture();
    logger.info("request", {
      headers: { cookie: "session=abc", authorization: "Bearer xyz", accept: "text/html" },
      accessToken: "tok",
      nested: { clientSecret: "shh", fine: 1 },
    });
    const text = lines[0] ?? "";
    for (const leaked of ["session=abc", "Bearer xyz", 'tok"', "shh"]) {
      expect(text).not.toContain(leaked);
    }
    expect(JSON.parse(text).headers.accept).toBe("text/html");
    expect(JSON.parse(text).nested.fine).toBe(1);
  });

  it("never writes a full email address, in fields, messages or errors", () => {
    const { lines, logger } = capture();
    logger.error("failed for person@example.com", {
      detail: "contact other@example.org",
      error: new Error("bad user third@example.net"),
    });
    const text = lines[0] ?? "";
    expect(text).not.toMatch(/@example\.(com|org|net)/);
    expect(text).toContain("[redacted-email]");
  });

  describe("structured values that must stay readable (M-A)", () => {
    const SESSION_TOKEN = "k3Jf9Zq2LmX8vB4nT7wR1sYc5dH0gA6e";

    it("keeps a UUID requestId, a 40-hex version and routes and paths", () => {
      const { lines, logger } = capture();
      logger.info("request", {
        requestId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        version: "0123456789abcdef0123456789abcdef01234567",
        route: "/api/auth/callback/google/oauth-proxy",
        path: "/app/settings",
        method: "GET",
        status: 200,
        durationMs: 12,
      });
      expect(JSON.parse(lines[0] ?? "")).toMatchObject({
        requestId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        version: "0123456789abcdef0123456789abcdef01234567",
        route: "/api/auth/callback/google/oauth-proxy",
        path: "/app/settings",
        method: "GET",
        status: 200,
        durationMs: 12,
      });
    });

    it("keeps the path of a full URL in free text while redacting its query values", () => {
      const { lines, logger } = capture();
      logger.info(
        "GET https://app.example.com/api/auth/callback/google/oauth-proxy?code=abc&state=xyz",
      );
      const message = JSON.parse(lines[0] ?? "").message as string;
      expect(message).toContain("https://app.example.com/api/auth/callback/google/oauth-proxy");
      expect(message).toContain("code=[redacted]");
      expect(message).toContain("state=[redacted]");
      expect(message).not.toMatch(/abc|xyz/);
    });

    it.each([
      ["requestId", "not-a-uuid-but-a-very-long-identifier-0123456789"],
      ["version", `${"a1b2c3d4".repeat(5)}zz`],
      ["route", `/api/${"a".repeat(40)}`],
      ["path", "/app?token=abc"],
      ["method", "get-with-a-very-long-token-like-value-0123456789"],
    ])("falls back to redaction when %s has the wrong shape", (key, value) => {
      const { lines, logger } = capture();
      logger.info("x", { [key]: value });
      expect(lines[0]).not.toContain(value);
    });

    it("is not fooled by prototype-named keys", () => {
      const { lines, logger } = capture();
      logger.info("x", { constructor: SESSION_TOKEN, toString: SESSION_TOKEN });
      expect(lines[0]).not.toContain(SESSION_TOKEN);
    });

    it("redacts a 32+ character session token, a JWT and query values in free text", () => {
      const { lines, logger } = capture();
      const jwt =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r";
      logger.error(
        `seen ${SESSION_TOKEN} and ${jwt} at /cb?token=tok1&code=cod2&state=sta3 /x#access_token=hash4`,
      );
      const message = JSON.parse(lines[0] ?? "").message as string;
      for (const leaked of [SESSION_TOKEN, "eyJhbGci", "tok1", "cod2", "sta3", "hash4"]) {
        expect(message).not.toContain(leaked);
      }
      expect(message).toContain("/cb?token=[redacted]");
    });
  });

  describe("short secret fragments in free text (L-A)", () => {
    it("redacts cookie, secret and password assignments but keeps the key", () => {
      const { lines, logger } = capture();
      logger.warn("cookie: better-auth.session_token=Zx9 password=hunter2 secret: s3cr3t");
      const message = JSON.parse(lines[0] ?? "").message as string;
      for (const leaked of ["Zx9", "hunter2", "s3cr3t"]) expect(message).not.toContain(leaked);
      for (const kept of ["cookie", "password", "secret"]) expect(message).toContain(kept);
    });

    it("drops URL credentials, including hosts without a TLD and postgres URLs", () => {
      const { lines, logger } = capture();
      logger.error("connect failed postgresql://u:pw@localhost:5432/db and http://a:b@host/x");
      const message = JSON.parse(lines[0] ?? "").message as string;
      expect(message).toContain("postgresql://[redacted]@localhost:5432/db");
      expect(message).not.toMatch(/u:pw|a:b/);
    });

    it("does not mangle ordinary text that merely mentions a keyword", () => {
      const { lines, logger } = capture();
      logger.info("token count 3");
      expect(JSON.parse(lines[0] ?? "").message).toBe("token count 3");
    });
  });

  it("drops entries below the minimum level", () => {
    const lines: string[] = [];
    const logger = createLogger({ minimumLevel: "warn", write: (line) => lines.push(line) });
    logger.info("quiet");
    logger.warn("loud");
    expect(lines).toHaveLength(1);
  });
});
