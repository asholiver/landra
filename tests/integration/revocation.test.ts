import { eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addAllowedEmail,
  listAllowedEmails,
  removeAllowedEmail,
} from "../../src/server/allowlist/allowlist";
import { runAllowlistCommand } from "../../src/server/allowlist/cli";
import { AuthRequiredError, requireUser } from "../../src/server/auth/session";
import { account, allowedEmail, session, user } from "../../src/server/db/schema";
import { seedAuthenticatedSession } from "../support/session";
import { createTestRuntime, integrationDatabaseUrl, testEnvironment } from "./helpers";

const runtime = createTestRuntime();
afterAll(() => runtime.pool.end());

beforeEach(async () => {
  await runtime.db.delete(session);
  await runtime.db.delete(account);
  await runtime.db.delete(user);
  await runtime.db.delete(allowedEmail);
});

async function seed(email: string) {
  const seeded = await seedAuthenticatedSession({ env: testEnvironment(), email });
  return { ...seeded, headers: new Headers({ cookie: seeded.cookieHeader }) };
}

async function sessionsOf(userId: string) {
  return runtime.db.select().from(session).where(eq(session.userId, userId));
}

function causeMessage(error: unknown): string {
  const cause = (error as { cause?: { message?: string } }).cause;
  return cause?.message ?? (error as Error).message;
}

describe("allowlist removal revokes access (M-1)", () => {
  it("(a) refuses a new session for a removed user, in the hook and in the database trigger", async () => {
    const owner = await seed("owner@example.com");
    await removeAllowedEmail(runtime.db, "owner@example.com");

    // Better Auth path: the hook refuses.
    const context = await runtime.auth.$context;
    await expect(context.internalAdapter.createSession(owner.userId, false)).rejects.toThrow();

    // Direct insert path, bypassing Better Auth entirely: the trigger refuses.
    const direct = runtime.db.insert(session).values({
      id: "direct-session",
      token: "direct-token",
      userId: owner.userId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const error = await direct.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).not.toBeNull();
    expect(causeMessage(error)).toContain("not on the approved list");
    expect(await sessionsOf(owner.userId)).toHaveLength(0);
  });

  it("(a) the trigger allows a session for an allowlisted user", async () => {
    const owner = await seed("owner@example.com");
    const context = await runtime.auth.$context;
    await context.internalAdapter.createSession(owner.userId, false);
    expect(await sessionsOf(owner.userId)).toHaveLength(2);
  });

  it("(b) an existing session is invalid immediately after removal", async () => {
    const owner = await seed("owner@example.com");
    const context = await runtime.auth.$context;
    await context.internalAdapter.createSession(owner.userId, false);
    expect((await runtime.auth.api.getSession({ headers: owner.headers }))?.user.id).toBe(
      owner.userId,
    );

    const result = await removeAllowedEmail(runtime.db, "OWNER@example.com");
    expect(result).toEqual({ removed: true, revokedSessions: 2 });

    expect(await runtime.auth.api.getSession({ headers: owner.headers })).toBeNull();
    expect(await sessionsOf(owner.userId)).toHaveLength(0);
    const request = new Request("http://localhost:5173/app", {
      headers: { cookie: owner.cookieHeader },
    });
    const rejection = await requireUser(runtime.auth, request).catch((caught) => caught);
    expect(rejection).toBeInstanceOf(AuthRequiredError);
  });

  it("(c) leaves other users' sessions and allowlist entries untouched", async () => {
    const owner = await seed("owner@example.com");
    const other = await seed("other@example.com");
    await removeAllowedEmail(runtime.db, "owner@example.com");

    expect(await runtime.auth.api.getSession({ headers: owner.headers })).toBeNull();
    expect((await runtime.auth.api.getSession({ headers: other.headers }))?.user.id).toBe(
      other.userId,
    );
    expect(await sessionsOf(other.userId)).toHaveLength(1);
    expect(await listAllowedEmails(runtime.db)).toEqual(["other@example.com"]);
  });

  it("(d) is atomic: a failure after the allowlist delete rolls the delete back", async () => {
    const owner = await seed("owner@example.com");
    await expect(
      removeAllowedEmail(runtime.db, "owner@example.com", (step) => {
        if (step === "allowlist-deleted") throw new Error("simulated failure");
      }),
    ).rejects.toThrow("simulated failure");

    expect(await listAllowedEmails(runtime.db)).toEqual(["owner@example.com"]);
    expect(await sessionsOf(owner.userId)).toHaveLength(1);
    expect((await runtime.auth.api.getSession({ headers: owner.headers }))?.user.id).toBe(
      owner.userId,
    );
  });

  it("(d) is atomic: a failure after the session revocation rolls the revocation back", async () => {
    const owner = await seed("owner@example.com");
    await expect(
      removeAllowedEmail(runtime.db, "owner@example.com", (step) => {
        if (step === "sessions-revoked") throw new Error("simulated failure");
      }),
    ).rejects.toThrow("simulated failure");

    expect(await listAllowedEmails(runtime.db)).toEqual(["owner@example.com"]);
    expect(await sessionsOf(owner.userId)).toHaveLength(1);
  });

  it("(d) a concurrent session insert never survives a removal", async () => {
    const owner = await seed("owner@example.com");
    const context = await runtime.auth.$context;
    // Interleave many sign-ins with the removal. Every attempt either fails or is revoked.
    const attempts = Array.from({ length: 20 }, () =>
      context.internalAdapter.createSession(owner.userId, false).catch(() => null),
    );
    const removal = removeAllowedEmail(runtime.db, "owner@example.com");
    await Promise.all([...attempts, removal]);
    expect(await sessionsOf(owner.userId)).toHaveLength(0);
  });

  it("(e) reports exactly what happened", async () => {
    const owner = await seed("owner@example.com");
    const context = await runtime.auth.$context;
    await context.internalAdapter.createSession(owner.userId, false);

    expect(await runAllowlistCommand(runtime.db, ["remove", " Owner@Example.com "])).toEqual({
      exitCode: 0,
      output: "Removed owner@example.com from the approved list and revoked 2 active session(s).",
    });
    expect(await runAllowlistCommand(runtime.db, ["remove", "owner@example.com"])).toEqual({
      exitCode: 0,
      output: "owner@example.com was not on the approved list. Revoked 0 active session(s).",
    });
    expect(await runAllowlistCommand(runtime.db, ["add", "new@example.com"])).toEqual({
      exitCode: 0,
      output: "Added new@example.com to the approved list.",
    });
  });

  it("revokes sessions even when the email was no longer listed (partial earlier removal)", async () => {
    const owner = await seed("owner@example.com");
    await runtime.db.delete(allowedEmail).where(eq(allowedEmail.email, "owner@example.com"));
    expect(await sessionsOf(owner.userId)).toHaveLength(1);
    expect(await removeAllowedEmail(runtime.db, "owner@example.com")).toEqual({
      removed: false,
      revokedSessions: 1,
    });
    await addAllowedEmail(runtime.db, "owner@example.com");
  });

  it("reads the session from the database on every request (cookie cache disabled)", async () => {
    const context = await runtime.auth.$context;
    expect(context.options.session?.cookieCache?.enabled).toBe(false);
  });
});

const WAIT_FOR_BLOCK_MS = 400;
const pause = (milliseconds: number) =>
  new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));

/**
 * Deterministic interleaving: client A inserts a session (the trigger takes FOR SHARE on the
 * allowlist row) and stays uncommitted; the removal must block on that lock; after A commits,
 * the removal's second statement must see and revoke A's session.
 */
async function removalRacingAnUncommittedSignIn(removalRuntime: typeof runtime) {
  const owner = await seed("owner@example.com");
  const clientA = new pg.Client({ connectionString: integrationDatabaseUrl() });
  await clientA.connect();
  try {
    await clientA.query("BEGIN");
    await clientA.query(
      `insert into "session" (id, token, user_id, expires_at)
       values ('racing-session', 'racing-token', $1, now() + interval '1 hour')`,
      [owner.userId],
    );

    let finished = false;
    const removal = removeAllowedEmail(removalRuntime.db, "owner@example.com").then((result) => {
      finished = true;
      return result;
    });
    await pause(WAIT_FOR_BLOCK_MS);
    expect(finished).toBe(false); // blocked on A's FOR SHARE lock

    await clientA.query("COMMIT");
    const result = await removal;
    return { owner, result };
  } finally {
    await clientA.end();
  }
}

describe("removal racing an uncommitted sign-in (L-C)", () => {
  it("blocks on the in-flight session insert, then revokes it too", async () => {
    const { owner, result } = await removalRacingAnUncommittedSignIn(runtime);
    expect(result).toEqual({ removed: true, revokedSessions: 2 });
    expect(await sessionsOf(owner.userId)).toHaveLength(0);
  });

  it("holds even when the database defaults to REPEATABLE READ (the isolation pin works)", async () => {
    const databaseName = new URL(integrationDatabaseUrl()).pathname.slice(1);
    expect(databaseName).toMatch(/^it_[a-z0-9]{12}$/);
    const admin = new pg.Client({ connectionString: integrationDatabaseUrl() });
    await admin.connect();
    // Applies to new connections only, so use a fresh runtime (new pool) for the removal.
    await admin.query(
      `ALTER DATABASE "${databaseName}" SET default_transaction_isolation = 'repeatable read'`,
    );
    const pinned = createTestRuntime();
    try {
      const probe = await pinned.pool.query("show default_transaction_isolation");
      expect(probe.rows[0]?.default_transaction_isolation).toBe("repeatable read");

      const { owner, result } = await removalRacingAnUncommittedSignIn(pinned);
      expect(result).toEqual({ removed: true, revokedSessions: 2 });
      expect(await sessionsOf(owner.userId)).toHaveLength(0);
    } finally {
      await pinned.pool.end();
      await admin.query(`ALTER DATABASE "${databaseName}" RESET default_transaction_isolation`);
      await admin.end();
    }
  });
});

describe("session trigger on UPDATE (L-D)", () => {
  it("refuses moving a session to a user whose email is not allowlisted", async () => {
    const owner = await seed("owner@example.com");
    await runtime.db.insert(user).values({
      id: "stranger-id",
      name: "Stranger",
      email: "stranger@example.com",
      emailVerified: true,
    });
    const update = runtime.db
      .update(session)
      .set({ userId: "stranger-id" })
      .where(eq(session.userId, owner.userId));
    const error = await update.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).not.toBeNull();
    expect(causeMessage(error)).toContain("not on the approved list");
    expect(await sessionsOf(owner.userId)).toHaveLength(1);
  });

  it("allows moving a session to another allowlisted user", async () => {
    const owner = await seed("owner@example.com");
    const other = await seed("other@example.com");
    await runtime.db
      .update(session)
      .set({ userId: other.userId })
      .where(eq(session.userId, owner.userId));
    expect(await sessionsOf(other.userId)).toHaveLength(2);
  });
});
