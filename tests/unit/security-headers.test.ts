import { describe, expect, it } from "vitest";
import {
  applySecurityHeaders,
  buildContentSecurityPolicy,
  securityHeaders,
} from "../../src/server/http/security-headers";

function directive(policy: string, name: string): string[] {
  const found = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
  return found ? found.split(" ").slice(1) : [];
}

describe("buildContentSecurityPolicy (R10)", () => {
  it("never allows unsafe-inline or unsafe-eval scripts, with or without a nonce", () => {
    for (const policy of [
      buildContentSecurityPolicy(),
      buildContentSecurityPolicy({ nonce: "abc123" }),
    ]) {
      const scripts = directive(policy, "script-src");
      expect(scripts).not.toContain("'unsafe-inline'");
      expect(scripts).not.toContain("'unsafe-eval'");
      expect(policy).not.toContain("unsafe-");
    }
  });

  it("allows only same-origin scripts, plus the nonce when there is one", () => {
    expect(directive(buildContentSecurityPolicy(), "script-src")).toEqual(["'self'"]);
    expect(directive(buildContentSecurityPolicy({ nonce: "abc123" }), "script-src")).toEqual([
      "'self'",
      "'nonce-abc123'",
    ]);
  });

  it("forbids framing, plugins and base-tag changes", () => {
    const policy = buildContentSecurityPolicy();
    expect(directive(policy, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(policy, "object-src")).toEqual(["'none'"]);
    expect(directive(policy, "base-uri")).toEqual(["'self'"]);
  });

  it("lets forms post to this site and redirect to Google (and nowhere else)", () => {
    expect(directive(buildContentSecurityPolicy(), "form-action")).toEqual([
      "'self'",
      "https://accounts.google.com",
    ]);
  });
});

describe("securityHeaders (R9, R10)", () => {
  it("carries every required header", () => {
    const headers = securityHeaders();
    expect(headers["X-Robots-Tag"]).toBe("noindex, nofollow");
    expect(headers["Strict-Transport-Security"]).toMatch(/^max-age=\d+/);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Permissions-Policy"]).toContain("geolocation=()");
  });

  it("can omit only the CSP (Vite dev server)", () => {
    const headers = securityHeaders({ omitContentSecurityPolicy: true });
    expect(headers["Content-Security-Policy"]).toBeUndefined();
    expect(headers["X-Robots-Tag"]).toBe("noindex, nofollow");
  });

  it("replaces headers already on a response", () => {
    const headers = new Headers({
      "X-Robots-Tag": "all",
      "Content-Security-Policy": "default-src *",
    });
    applySecurityHeaders(headers, { nonce: "n1" });
    expect(headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(headers.get("Content-Security-Policy")).toContain("'nonce-n1'");
    expect(headers.get("Content-Security-Policy")).not.toContain("default-src *");
  });
});
