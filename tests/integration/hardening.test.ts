import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { account, allowedEmail, session, user } from "../../src/server/db/schema";
import { seedAuthenticatedSession } from "../support/session";
import { createTestRuntime, testEnvironment } from "./helpers";

const STRONG_SECRET = "q7Lr2mX9vB4nT8wK1sZ5cD0hJ6gF3yPaUe+RoNi/AdE=";
const productionOverrides = {
  NODE_ENV: "production",
  BETTER_AUTH_URL: "https://app.example.com",
  BETTER_AUTH_SECRET: STRONG_SECRET,
  GOOGLE_CLIENT_ID: "dummy-client-id",
  GOOGLE_CLIENT_SECRET: "dummy-client-secret",
};

const runtime = createTestRuntime();
const production = createTestRuntime(productionOverrides);
afterAll(async () => {
  await runtime.pool.end();
  await production.pool.end();
});

beforeEach(async () => {
  await runtime.db.delete(session);
  await runtime.db.delete(account);
  await runtime.db.delete(user);
  await runtime.db.delete(allowedEmail);
});

describe("cookie attributes in a production-like config (M-3)", () => {
  it("sets a __Secure- prefixed, Secure, HttpOnly, SameSite=Lax session cookie", async () => {
    const seeded = await seedAuthenticatedSession({
      env: { ...testEnvironment(), ...productionOverrides },
      email: "owner@example.com",
    });
    expect(seeded.cookieName).toBe("__Secure-better-auth.session_token");

    const headers = new Headers({ cookie: seeded.cookieHeader });
    expect((await production.auth.api.getSession({ headers }))?.user.id).toBe(seeded.userId);

    const response = await production.auth.api.signOut({ headers, asResponse: true });
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__Secure-better-auth.session_token=");
    expect(setCookie).toMatch(/;\s*Secure/i);
    expect(setCookie).toMatch(/;\s*HttpOnly/i);
    expect(setCookie).toMatch(/;\s*SameSite=Lax/i);
  });

  it("does not use the Secure prefix in a local config", async () => {
    const seeded = await seedAuthenticatedSession({
      env: testEnvironment(),
      email: "local@example.com",
    });
    expect(seeded.cookieName).toBe("better-auth.session_token");
  });
});

describe("Better Auth logging is redacted (M-2)", () => {
  it("leaks no token, email or query parameters when the auth database fails", async () => {
    const seeded = await seedAuthenticatedSession({
      env: testEnvironment(),
      email: "owner@example.com",
    });
    const sessionToken = decodeURIComponent(seeded.cookieValue).split(".")[0] ?? "";
    expect(sessionToken.length).toBeGreaterThan(10);

    // A separate runtime whose pool is closed, so every auth query fails with a driver error
    // whose message embeds the SQL and its bound parameters (token and email).
    const broken = createTestRuntime();
    await broken.pool.end();
    await broken.auth.api
      .getSession({ headers: new Headers({ cookie: seeded.cookieHeader }) })
      .catch(() => null);
    const context = await broken.auth.$context;
    await context.internalAdapter.findUserByEmail("owner@example.com").catch(() => null);

    const output = broken.logLines.join("\n");
    expect(broken.logLines.length).toBeGreaterThan(0);
    expect(output).not.toContain(sessionToken);
    expect(output).not.toContain("@example.com");
    // Anything after "params:" must be the redaction marker, never bound values.
    expect(output).not.toMatch(/params:(?!\s*\[redacted\])/i);
    expect(output).not.toContain("owner@");
  });
});
