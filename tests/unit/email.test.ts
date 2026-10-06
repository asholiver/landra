import { describe, expect, it } from "vitest";
import { normaliseEmail, parseEmail } from "../../src/shared/email";

describe("email normalisation", () => {
  it("trims and lower-cases", () => {
    expect(normaliseEmail("  Someone@Example.COM \n")).toBe("someone@example.com");
  });

  it("parseEmail returns the normalised address for valid input", () => {
    expect(parseEmail("  Someone@Example.COM ")).toBe("someone@example.com");
  });

  it.each(["", "   ", "not-an-email", "a@b", "two@@example.com", "a@example.com b@example.com"])(
    "parseEmail rejects %j",
    (input) => {
      expect(parseEmail(input)).toBeNull();
    },
  );
});
