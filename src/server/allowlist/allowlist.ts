import { eq, sql } from "drizzle-orm";
import { parseEmail } from "../../shared/email";
import type { Database } from "../db/client";
import { allowedEmail, session, user } from "../db/schema";

export class InvalidEmailError extends Error {
  constructor() {
    super("Not a valid email address");
    this.name = "InvalidEmailError";
  }
}

function requireEmail(rawEmail: string): string {
  const email = parseEmail(rawEmail);
  if (email === null) throw new InvalidEmailError();
  return email;
}

/** Adds an email (normalised). Returns false if it was already present. */
export async function addAllowedEmail(
  database: Database,
  rawEmail: string,
  note?: string,
): Promise<boolean> {
  const email = requireEmail(rawEmail);
  const inserted = await database
    .insert(allowedEmail)
    .values({ email, note: note ?? null })
    .onConflictDoNothing()
    .returning({ email: allowedEmail.email });
  return inserted.length > 0;
}

export type RemovalStep = "allowlist-deleted" | "sessions-revoked";

export type RemovalResult = { removed: boolean; revokedSessions: number };

/**
 * Removes an email from the approved list AND revokes every existing session of the user with
 * that email, in one transaction: either both happen or neither does.
 *
 * Ordering matters for the race with a concurrent sign-in (analysis in
 * drizzle/0001_session_requires_allowlist.sql): the allowlist row is deleted first, taking its
 * exclusive row lock, and sessions are deleted second in a new READ COMMITTED statement. The
 * session trigger locks the allowlist row FOR SHARE, so a concurrent insert either completes
 * before our session delete (and is deleted by it) or is refused once the row is gone.
 *
 * `afterStep` is a test seam for simulating a failure part-way through; production callers
 * omit it.
 */
export async function removeAllowedEmail(
  database: Database,
  rawEmail: string,
  afterStep?: (step: RemovalStep) => Promise<void> | void,
): Promise<RemovalResult> {
  const email = requireEmail(rawEmail);
  return database.transaction(
    async (transaction) => {
      const removedRows = await transaction
        .delete(allowedEmail)
        .where(eq(allowedEmail.email, email))
        .returning({ email: allowedEmail.email });
      await afterStep?.("allowlist-deleted");

      // Revoke even when the email was not on the list: it clears sessions left by an earlier,
      // partial removal. user.email is stored lower-case by Better Auth; compare lower-cased.
      const revoked = await transaction
        .delete(session)
        .where(
          sql`${session.userId} in (select ${user.id} from ${user} where lower(${user.email}) = ${email})`,
        )
        .returning({ id: session.id });
      await afterStep?.("sessions-revoked");

      return { removed: removedRows.length > 0, revokedSessions: revoked.length };
      // Pinned: the race analysis needs the second statement to take a fresh snapshot, so a
      // database or role default of REPEATABLE READ or SERIALIZABLE must not apply here.
    },
    { isolationLevel: "read committed" },
  );
}

export async function listAllowedEmails(database: Database): Promise<string[]> {
  const rows = await database.select({ email: allowedEmail.email }).from(allowedEmail);
  return rows.map((row) => row.email).sort();
}

export async function isEmailAllowed(database: Database, rawEmail: string): Promise<boolean> {
  const email = parseEmail(rawEmail);
  if (email === null) return false;
  const rows = await database
    .select({ email: allowedEmail.email })
    .from(allowedEmail)
    .where(eq(allowedEmail.email, email))
    .limit(1);
  return rows.length > 0;
}
