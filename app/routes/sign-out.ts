import { redirect } from "react-router";
import { buildTrustedOrigins } from "../../src/server/auth/auth";
import { isTrustedOrigin } from "../../src/server/auth/origin";
import { getConfig } from "../../src/server/config";
import { getAuth, logger } from "../../src/server/runtime";
import type { Route } from "./+types/sign-out";

// POST only (the form in the app shell). Invalidates the server session, clears the cookie
// (R6) and returns to the home page.
export async function action({ request }: Route.ActionArgs) {
  try {
    // Inside the try so invalid configuration fails the same closed way as a database failure
    // (503), rather than an unexplained 500.
    const config = getConfig();
    if (!isTrustedOrigin(request.headers, buildTrustedOrigins(config))) {
      return new Response("Forbidden", { status: 403 });
    }
    // Better Auth's signOut swallows a failed session delete and still clears the cookie, which
    // would leave the server session alive while the user believes they signed out. Reading the
    // session first throws when the database is unreachable, so that case fails closed (503)
    // with the cookie untouched. (A database that fails between this read and the delete is
    // still not detected.)
    await getAuth().api.getSession({ headers: request.headers });
    const { headers } = await getAuth().api.signOut({
      headers: request.headers,
      returnHeaders: true,
    });
    return redirect("/", { headers });
  } catch (error) {
    logger.error("sign-out failed", {
      error: error instanceof Error ? error : new Error("unknown error"),
    });
    // Fixed text, no internals. The cookie is left untouched: sign-out did not happen.
    return new Response("Sign-out is temporarily unavailable. Please try again.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
