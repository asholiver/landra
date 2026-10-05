import { describe, expect, it, vi } from "vitest";
import { decideAccess } from "../../src/server/auth/access-policy";

const allowlist = (emails: string[]) => async (email: string) => emails.includes(email);

describe("decideAccess (BR1, BR2)", () => {
  it("allows a verified, allowlisted email", async () => {
    const decision = await decideAccess(
      { email: "owner@example.com", emailVerified: true },
      allowlist(["owner@example.com"]),
    );
    expect(decision).toEqual({ allowed: true });
  });

  it("denies a verified email that is not allowlisted", async () => {
    const decision = await decideAccess(
      { email: "stranger@example.com", emailVerified: true },
      allowlist(["owner@example.com"]),
    );
    expect(decision).toEqual({ allowed: false, reason: "not_allowlisted" });
  });

  it("denies an unverified email even when allowlisted, without consulting the allowlist", async () => {
    const check = vi.fn(async () => true);
    const decision = await decideAccess(
      { email: "owner@example.com", emailVerified: false },
      check,
    );
    expect(decision).toEqual({ allowed: false, reason: "unverified_email" });
    expect(check).not.toHaveBeenCalled();
  });

  it.each([undefined, null])(
    "denies an unknown verification status (%s)",
    async (emailVerified) => {
      const decision = await decideAccess(
        { email: "owner@example.com", emailVerified },
        allowlist(["owner@example.com"]),
      );
      expect(decision.allowed).toBe(false);
    },
  );

  it("denies a missing email", async () => {
    expect(await decideAccess({ emailVerified: true }, allowlist([]))).toEqual({
      allowed: false,
      reason: "missing_email",
    });
  });
});
