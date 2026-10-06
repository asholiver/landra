import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { account, allowedEmail, session, user } from "../../src/server/db/schema";
import { seedAuthenticatedSession } from "../support/session";
import { createTestRuntime, testEnvironment } from "./helpers";

/**
 * The allowlist is checked against the user's email when a session is created (hook and DB
 * trigger). These tests pin the Better Auth 1.7.7 defaults that keep that email fixed afterwards
 * through the raw /api/auth routes, so an upgrade that changes a default fails here (CodeRabbit
 * PR #1 hardening proposal). Account linking requires the same email by default
 * (`allowDifferentEmails`); that needs a real Google round trip and is not automated.
 */
const ORIGIN = "http://localhost:5173";
const OWNER_EMAIL = "owner@example.com";

const runtime = createTestRuntime();
afterAll(() => runtime.pool.end());

beforeEach(async () => {
  await runtime.db.delete(session);
  await runtime.db.delete(account);
  await runtime.db.delete(user);
  await runtime.db.delete(allowedEmail);
});

function post(path: string, cookieHeader: string, body: unknown) {
  return runtime.auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie: cookieHeader },
      body: JSON.stringify(body),
    }),
  );
}

async function errorCode(response: Response) {
  return ((await response.json()) as { code?: string }).code;
}

async function storedUser(userId: string) {
  const [row] = await runtime.db.select().from(user).where(eq(user.id, userId));
  return row;
}

describe("raw auth routes cannot change a signed-in user's identity", () => {
  it("control: the seeded session can update its own name", async () => {
    const owner = await seedAuthenticatedSession({ env: testEnvironment(), email: OWNER_EMAIL });
    const response = await post("/update-user", owner.cookieHeader, { name: "Renamed" });
    expect(response.status).toBe(200);
    expect((await storedUser(owner.userId))?.name).toBe("Renamed");
  });

  it("refuses an email change through /update-user", async () => {
    const owner = await seedAuthenticatedSession({ env: testEnvironment(), email: OWNER_EMAIL });
    const response = await post("/update-user", owner.cookieHeader, {
      email: "someone-else@example.com",
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("EMAIL_CAN_NOT_BE_UPDATED");
    expect((await storedUser(owner.userId))?.email).toBe(OWNER_EMAIL);
  });

  it("refuses /change-email (disabled)", async () => {
    const owner = await seedAuthenticatedSession({ env: testEnvironment(), email: OWNER_EMAIL });
    const response = await post("/change-email", owner.cookieHeader, {
      newEmail: "someone-else@example.com",
    });
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("CHANGE_EMAIL_DISABLED");
    expect((await storedUser(owner.userId))?.email).toBe(OWNER_EMAIL);
  });

  it("refuses /delete-user (disabled) and keeps the user and session", async () => {
    const owner = await seedAuthenticatedSession({ env: testEnvironment(), email: OWNER_EMAIL });
    const response = await post("/delete-user", owner.cookieHeader, {});
    expect(response.status).toBe(404);
    expect(await storedUser(owner.userId)).toBeDefined();
    const sessions = await runtime.db
      .select()
      .from(session)
      .where(eq(session.userId, owner.userId));
    expect(sessions).toHaveLength(1);
  });
});
