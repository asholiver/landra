import { data, redirect } from "react-router";
import {
  AuthRequiredError,
  requireUser as requireSessionUser,
} from "../../src/server/auth/session";
import { getAuth, logger } from "../../src/server/runtime";

/**
 * For `/app/*` loaders and actions: returns the user or throws a redirect to /sign-in (R3).
 * If the session cannot be checked at all (database down, invalid configuration) it throws a
 * 503 so the error page shows, rather than treating the visitor as signed out or leaking detail.
 */
export async function requireUser(request: Request) {
  try {
    return await requireSessionUser(getAuth(), request);
  } catch (error) {
    if (error instanceof AuthRequiredError) throw redirect(error.signInPath);
    logger.error("could not check the session", {
      error: error instanceof Error ? error : new Error("unknown error"),
    });
    throw data(null, { status: 503 });
  }
}
