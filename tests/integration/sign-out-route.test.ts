import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { account, allowedEmail, session, user } from "../../src/server/db/schema";
import { seedAuthenticatedSession } from "../support/session";
import { createTestRuntime, testEnvironment } from "./helpers";

const runtime = createTestRuntime();

// The route reads its process-wide singletons from these modules; give it this run's own runtime.
vi.mock("../../src/server/runtime", () => ({
  getAuth: () => runtime.auth,
  getDatabase: () => runtime.db,
  logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
}));
vi.mock("../../src/server/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/config")>()),
  getConfig: () => runtime.config,
}));

const { action } = await import("../../app/routes/sign-out");

afterAll(() => runtime.pool.end());

beforeEach(async () => {
  await runtime.db.delete(session);
  await runtime.db.delete(account);
  await runtime.db.delete(user);
  await runtime.db.delete(allowedEmail);
});

async function signOutRequest(cookie: string): Promise<Response> {
  const headers = new Headers({ origin: "http://localhost:5173" });
  if (cookie) headers.set("cookie", cookie);
  const request = new Request("http://localhost:5173/sign-out", { method: "POST", headers });
  return (await action({ request } as Parameters<typeof action>[0])) as Response;
}

const sessionRows = (userId: string) =>
  runtime.db.select().from(session).where(eq(session.userId, userId));

describe("POST /sign-out (L1: fails closed when the delete fails)", () => {
  it("deletes the session row and clears the cookie on the normal path", async () => {
    const seeded = await seedAuthenticatedSession({
      env: testEnvironment(),
      email: "owner@example.com",
    });
    expect(await sessionRows(seeded.userId)).toHaveLength(1);

    const response = await signOutRequest(seeded.cookieHeader);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    const cleared = response.headers.getSetCookie().join("\n");
    expect(cleared).toContain(`${seeded.cookieName}=;`);
    expect(cleared).toMatch(/Max-Age=0/i);
    expect(await sessionRows(seeded.userId)).toHaveLength(0);
  });

  it("returns 503 with no Set-Cookie and keeps the row when the database rejects the delete", async () => {
    const seeded = await seedAuthenticatedSession({
      env: testEnvironment(),
      email: "owner@example.com",
    });
    // The session READ is real (Postgres); only the write is made to fail, by stubbing the
    // adapter call. No schema change is involved.
    const context = await runtime.auth.$context;
    const failingDelete = vi
      .spyOn(context.internalAdapter, "deleteSession")
      .mockRejectedValue(new Error("simulated write failure"));
    const signOutSpy = vi.spyOn(runtime.auth.api, "signOut");
    try {
      const response = await signOutRequest(seeded.cookieHeader);
      expect(failingDelete).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(503);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await response.text()).toBe("Sign-out is temporarily unavailable. Please try again.");
      expect(await sessionRows(seeded.userId)).toHaveLength(1);
      // The cookie-clearing step is never reached when the delete fails.
      expect(signOutSpy).not.toHaveBeenCalled();
    } finally {
      failingDelete.mockRestore();
      signOutSpy.mockRestore();
    }
  });

  it("still clears the cookies for a request that carries no session", async () => {
    const response = await signOutRequest("");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
  });
});
