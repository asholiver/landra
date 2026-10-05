import { redirect } from "react-router";
import {
  AuthRequiredError,
  requireUser as requireSessionUser,
} from "../../src/server/auth/session";
import { getAuth } from "../../src/server/runtime";

/** For `/app/*` loaders and actions: returns the user or throws a redirect to /sign-in (R3). */
export async function requireUser(request: Request) {
  try {
    return await requireSessionUser(getAuth(), request);
  } catch (error) {
    if (error instanceof AuthRequiredError) throw redirect(error.signInPath);
    throw error;
  }
}
