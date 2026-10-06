import { isEmailAllowed } from "../allowlist/allowlist";
import type { Database } from "../db/client";

export type AccessDecision = { allowed: true } | { allowed: false; reason: AccessDenialReason };
export type AccessDenialReason = "unverified_email" | "not_allowlisted" | "missing_email";

/**
 * BR1 and BR2: only verified emails that are on the allowlist may have an account.
 * `checkAllowlist` is injected so the rule is unit-testable without a database.
 */
export async function decideAccess(
  candidate: { email?: string | null; emailVerified?: boolean | null },
  checkAllowlist: (email: string) => Promise<boolean>,
): Promise<AccessDecision> {
  if (!candidate.email) return { allowed: false, reason: "missing_email" };
  if (candidate.emailVerified !== true) return { allowed: false, reason: "unverified_email" };
  const allowed = await checkAllowlist(candidate.email);
  return allowed ? { allowed: true } : { allowed: false, reason: "not_allowlisted" };
}

export function databaseAllowlistCheck(database: Database) {
  return (email: string) => isEmailAllowed(database, email);
}
