import { describe, expect, it } from "vitest";
import { isTrustedOrigin } from "../../src/server/auth/origin";

const trusted = ["https://app.example.com"];

describe("isTrustedOrigin (CSRF on sign-in and sign-out)", () => {
  it("accepts a trusted origin", () => {
    expect(isTrustedOrigin(new Headers({ Origin: "https://app.example.com" }), trusted)).toBe(true);
  });

  it.each([
    "https://evil.example",
    "https://app.example.com.evil.example",
    "http://app.example.com",
    "https://app.example.com:8443",
    "null",
    "",
  ])("refuses %j", (origin) => {
    expect(isTrustedOrigin(new Headers({ Origin: origin }), trusted)).toBe(false);
  });

  it("refuses a request with no Origin header", () => {
    expect(isTrustedOrigin(new Headers(), trusted)).toBe(false);
  });
});
