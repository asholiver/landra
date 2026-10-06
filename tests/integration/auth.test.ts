import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addAllowedEmail, removeAllowedEmail } from "../../src/server/allowlist/allowlist";
import { account, allowedEmail, session, user } from "../../src/server/db/schema";
import { seedAuthenticatedSession } from "../support/session";
import { createTestRuntime, testEnvironment } from "./helpers";

const runtime = createTestRuntime();
afterAll(() => runtime.pool.end());

async function rowCounts() {
  const count = async (table: typeof user | typeof session | typeof account) =>
    (await runtime.db.select().from(table)).length;
  return {
    users: await count(user),
    sessions: await count(session),
    accounts: await count(account),
  };
}

async function createOAuthUser(email: string, emailVerified = true) {
  const context = await runtime.auth.$context;
  return context.internalAdapter.createOAuthUser(
    { email, name: "Test", emailVerified },
    { providerId: "google", accountId: `google-${email}` },
  );
}

beforeEach(async () => {
  await runtime.db.delete(session);
  await runtime.db.delete(account);
  await runtime.db.delete(user);
  await runtime.db.delete(allowedEmail);
});

describe("user-creation hook (BR1, BR2, R5)", () => {
  it("creates user and account for a verified, allowlisted email", async () => {
    await addAllowedEmail(runtime.db, "owner@example.com");
    await createOAuthUser("owner@example.com");
    expect(await rowCounts()).toMatchObject({ users: 1, accounts: 1 });
  });

  it("refuses a non-allowlisted email and leaves no user, account or session rows", async () => {
    await addAllowedEmail(runtime.db, "owner@example.com");
    await expect(createOAuthUser("stranger@example.com")).rejects.toThrow();
    expect(await rowCounts()).toEqual({ users: 0, sessions: 0, accounts: 0 });
  });

  it("refuses an unverified email even when allowlisted, leaving no rows", async () => {
    await addAllowedEmail(runtime.db, "owner@example.com");
    await expect(createOAuthUser("owner@example.com", false)).rejects.toThrow();
    expect(await rowCounts()).toEqual({ users: 0, sessions: 0, accounts: 0 });
  });

  it("matches the allowlist case-insensitively", async () => {
    await addAllowedEmail(runtime.db, "Owner@Example.com");
    await createOAuthUser("OWNER@example.com");
    expect((await rowCounts()).users).toBe(1);
  });

  it("stops an existing user signing in once removed from the allowlist", async () => {
    await addAllowedEmail(runtime.db, "owner@example.com");
    const created = await createOAuthUser("owner@example.com");
    const context = await runtime.auth.$context;
    await removeAllowedEmail(runtime.db, "owner@example.com");
    await expect(context.internalAdapter.createSession(created.user.id, false)).rejects.toThrow();
    expect((await rowCounts()).sessions).toBe(0);
  });
});

describe("sessions (R6)", () => {
  it("accepts a seeded session cookie and invalidates it server-side on sign-out", async () => {
    const seeded = await seedAuthenticatedSession({
      env: testEnvironment(),
      email: "owner@example.com",
    });
    const headers = new Headers({ cookie: seeded.cookieHeader });

    const before = await runtime.auth.api.getSession({ headers });
    expect(before?.user.id).toBe(seeded.userId);

    const response = await runtime.auth.api.signOut({ headers, asResponse: true });
    expect(response.ok).toBe(true);
    expect(response.headers.get("set-cookie") ?? "").toMatch(/Max-Age=0/i);

    expect(await runtime.auth.api.getSession({ headers })).toBeNull();
    const remaining = await runtime.db
      .select()
      .from(session)
      .where(eq(session.userId, seeded.userId));
    expect(remaining).toHaveLength(0);
  });

  it("rejects a tampered session cookie", async () => {
    const seeded = await seedAuthenticatedSession({
      env: testEnvironment(),
      email: "owner@example.com",
    });
    const forged = `${seeded.cookieName}=${encodeURIComponent(`forged.${await makeSignature("forged", "wrong-secret")}`)}`;
    expect(
      await runtime.auth.api.getSession({ headers: new Headers({ cookie: forged }) }),
    ).toBeNull();
  });
});
