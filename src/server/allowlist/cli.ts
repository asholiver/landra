import { parseEmail } from "../../shared/email";
import type { Database } from "../db/client";
import {
  addAllowedEmail,
  InvalidEmailError,
  listAllowedEmails,
  removeAllowedEmail,
} from "./allowlist";

export const ALLOWLIST_USAGE = "Usage: pnpm allowlist add|remove <email> | pnpm allowlist list";

/** Runs one allowlist command and returns what to print and the process exit code (R13). */
export async function runAllowlistCommand(
  database: Database,
  args: string[],
): Promise<{ exitCode: number; output: string }> {
  const [command, rawEmail, ...extra] = args;
  try {
    if (command === "list" && rawEmail === undefined) {
      const emails = await listAllowedEmails(database);
      return { exitCode: 0, output: emails.join("\n") };
    }
    if (
      (command === "add" || command === "remove") &&
      rawEmail !== undefined &&
      extra.length === 0
    ) {
      const email = parseEmail(rawEmail) ?? rawEmail;
      if (command === "add") {
        const added = await addAllowedEmail(database, rawEmail);
        const message = added
          ? `Added ${email} to the approved list.`
          : `${email} is already on the approved list.`;
        return { exitCode: 0, output: message };
      }
      const { removed, revokedSessions } = await removeAllowedEmail(database, rawEmail);
      const message = removed
        ? `Removed ${email} from the approved list and revoked ${revokedSessions} active session(s).`
        : `${email} was not on the approved list. Revoked ${revokedSessions} active session(s).`;
      return { exitCode: 0, output: message };
    }
    return { exitCode: 2, output: ALLOWLIST_USAGE };
  } catch (error) {
    if (error instanceof InvalidEmailError) {
      return { exitCode: 2, output: "Not a valid email address." };
    }
    throw error;
  }
}
