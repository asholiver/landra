import { z } from "zod";

/** Canonical form used for storage and comparison: trimmed and lower-cased. */
export function normaliseEmail(rawEmail: string): string {
  return rawEmail.trim().toLowerCase();
}

/** Parses and normalises an email address. Rejects anything that is not a plausible email. */
export const emailSchema = z.string().max(320).transform(normaliseEmail).pipe(z.email());

/** Returns the normalised email, or null when the input is not a valid email address. */
export function parseEmail(rawEmail: string): string | null {
  const result = emailSchema.safeParse(rawEmail);
  return result.success ? result.data : null;
}
