import type { Logger } from "../logging/logger";

type BetterAuthLevel = "debug" | "info" | "warn" | "error";

/**
 * Routes Better Auth's own logging through the app's redacting logger so DB errors, tokens and
 * emails never reach stdout unredacted (R11). Error objects are reduced to name and message;
 * the logger redacts the message (including anything after "params:").
 */
export function createBetterAuthLogLine(logger: Logger) {
  return (level: BetterAuthLevel, message: string, ...details: unknown[]) => {
    const fields: Record<string, unknown> = { source: "better-auth" };
    const reduced = details.map((detail) =>
      detail instanceof Error
        ? { name: detail.name, message: detail.message }
        : typeof detail === "string"
          ? detail
          : typeof detail === "object" && detail !== null
            ? detail
            : String(detail),
    );
    if (reduced.length > 0) fields.details = reduced;
    logger[level](message, fields);
  };
}
