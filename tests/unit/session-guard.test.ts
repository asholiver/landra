import { describe, expect, it } from "vitest";
import { AuthRequiredError, requireUser, type SessionReader } from "../../src/server/auth/session";

const signedOut: SessionReader = { api: { getSession: async () => null } };
const signedIn: SessionReader = {
  api: { getSession: async () => ({ user: { id: "u1", name: "Ada", email: "ada@example.com" } }) },
};

describe("requireUser (R3, AC8)", () => {
  it("returns the user when a session exists", async () => {
    const user = await requireUser(signedIn, new Request("http://localhost/app"));
    expect(user.id).toBe("u1");
  });

  it.each(["http://localhost/app", "http://localhost/app/anything"])(
    "throws AuthRequiredError pointing at /sign-in for %s",
    async (url) => {
      const error = await requireUser(signedOut, new Request(url)).catch((caught) => caught);
      expect(error).toBeInstanceOf(AuthRequiredError);
      expect((error as AuthRequiredError).signInPath.startsWith("/sign-in")).toBe(true);
    },
  );

  it("never produces an off-origin sign-in path, whatever the request URL looks like", async () => {
    for (const url of [
      "http://localhost//evil.example/app",
      "http://localhost/app?returnTo=https://evil.example",
      "http://localhost/%5Cevil.example",
    ]) {
      const error = (await requireUser(signedOut, new Request(url)).catch(
        (caught) => caught,
      )) as AuthRequiredError;
      const target = new URL(error.signInPath, "http://localhost");
      expect(target.origin).toBe("http://localhost");
      expect(target.pathname).toBe("/sign-in");
      const returnTo = target.searchParams.get("returnTo");
      if (returnTo) expect(returnTo.startsWith("//")).toBe(false);
    }
  });
});
