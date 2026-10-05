import { describe, expect, it } from "vitest";
import { createBetterAuthLogLine } from "../../src/server/auth/auth-logger";
import { createLogger, redactText } from "../../src/server/logging/logger";

const SESSION_TOKEN = "k3Jf9Zq2LmX8vB4nT7wR1sYc5dH0gA6e";

function capture() {
  const lines: string[] = [];
  const logger = createLogger({ minimumLevel: "debug", write: (line) => lines.push(line) });
  return { lines, log: createBetterAuthLogLine(logger) };
}

describe("redactText (M-2)", () => {
  it("drops everything after params:", () => {
    const text = redactText(
      `Failed query: select * from "session" where token = $1\nparams: abc123,owner`,
    );
    expect(text).toContain("params: [redacted]");
    expect(text).not.toContain("abc123");
  });

  it("redacts bearer values, long token-like runs and emails", () => {
    const text = redactText(`Bearer abc.def ${SESSION_TOKEN}.c2lnbmF0dXJl owner@example.com`);
    expect(text).not.toContain("abc.def");
    expect(text).not.toContain(SESSION_TOKEN);
    expect(text).not.toContain("@example.com");
  });

  it("leaves ordinary short text alone", () => {
    expect(redactText("sign-up refused")).toBe("sign-up refused");
  });
});

describe("Better Auth log adapter (M-2)", () => {
  it("maps levels and reduces Error objects to a redacted name and message", () => {
    const { lines, log } = capture();
    const error = new Error(
      `Failed query: select * from "session" where token = $1\nparams: ${SESSION_TOKEN},owner@example.com`,
    );
    error.name = "DrizzleQueryError";
    log("error", "INTERNAL_SERVER_ERROR", error);
    log("warn", "careful");
    const [first, second] = lines.map((line) => JSON.parse(line));
    expect(first).toMatchObject({ level: "error", source: "better-auth" });
    expect(first.details[0].name).toBe("DrizzleQueryError");
    expect(second.level).toBe("warn");
    expect(lines.join("\n")).not.toContain(SESSION_TOKEN);
    expect(lines.join("\n")).not.toContain("@example.com");
    expect(lines.join("\n")).not.toContain("stack");
  });

  it("redacts sensitive keys inside object details", () => {
    const { lines, log } = capture();
    log("info", "context", { token: SESSION_TOKEN, ok: true });
    expect(lines[0]).not.toContain(SESSION_TOKEN);
    expect(JSON.parse(lines[0] ?? "").details[0].ok).toBe(true);
  });
});
