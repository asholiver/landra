import { describe, expect, it } from "vitest";
import { sanitiseReturnPath } from "../../src/server/auth/return-path";
import { buildSignInPath } from "../../src/server/auth/session";

const REJECTED_VECTORS: string[] = [
  "https://evil.example",
  "http://evil.example/app",
  "//evil.example",
  "//evil.example/app",
  "///evil.example",
  "/\\evil.example",
  "\\\\evil.example",
  "\\/evil.example",
  "/%5Cevil.example",
  "/%5cevil.example",
  "%2F%2Fevil.example",
  "/%2F/evil.example",
  "/%252F%252Fevil.example",
  "/%255Cevil.example",
  "javascript:alert(1)",
  "evil.example",
  "app",
  "",
  " /app",
  "/app\n//evil.example",
  "/app\r\nSet-Cookie: x=1",
  "/\t/evil.example",
  "/ /evil.example",
  "data:text/html,x",
  // Dot segments that normalise to a protocol-relative URL.
  "/.//evil.example",
  "/..//evil.example",
  "/a/..//evil.example",
  "/%2e//evil.example",
  "/%2e%2e//evil.example",
  // Encoded separators that survive dot-segment normalisation.
  "/%2e/%2fevil.example",
  "/%2e/%2f%2fevil.example",
  "/%2e%2e/%2f%2fevil.example",
  `/${"a".repeat(3000)}`,
];

describe("sanitiseReturnPath (open redirect)", () => {
  it.each([
    ["/app", "/app"],
    ["/app/opportunities", "/app/opportunities"],
    ["/app/search?q=a%20b&page=2", "/app/search?q=a%20b&page=2"],
    ["/app?progress=100%25", "/app?progress=100%25"],
    ["/app/settings?tab=a", "/app/settings?tab=a"],
  ])("keeps the same-origin path %s", (input, expected) => {
    expect(sanitiseReturnPath(input)).toBe(expected);
  });

  it.each(REJECTED_VECTORS)("rejects %j", (input) => {
    expect(sanitiseReturnPath(input)).toBe("/app");
  });

  it("never returns anything other than a single-slash same-origin path (all vectors)", () => {
    for (const input of REJECTED_VECTORS) {
      const output = sanitiseReturnPath(input, "/fallback");
      expect(output.startsWith("/")).toBe(true);
      expect(output.startsWith("//")).toBe(false);
      expect(output.startsWith("/\\")).toBe(false);
      expect(new URL(output, "https://app.example").origin).toBe("https://app.example");
    }
  });

  it.each([null, undefined])("rejects %s", (input) => {
    expect(sanitiseReturnPath(input)).toBe("/app");
  });

  it("uses the supplied fallback", () => {
    expect(sanitiseReturnPath("https://evil.example", "/")).toBe("/");
  });
});

describe("buildSignInPath", () => {
  it("returns plain /sign-in for the default landing path", () => {
    expect(buildSignInPath("http://localhost:5173/app")).toBe("/sign-in");
  });

  it("carries the requested same-origin path as an encoded returnTo", () => {
    expect(buildSignInPath("http://localhost:5173/app/anything?x=1")).toBe(
      "/sign-in?returnTo=%2Fapp%2Fanything%3Fx%3D1",
    );
  });
});
