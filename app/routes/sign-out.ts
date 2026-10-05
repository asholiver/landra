import { data, redirect } from "react-router";
import { buildTrustedOrigins } from "../../src/server/auth/auth";
import { isTrustedOrigin } from "../../src/server/auth/origin";
import { getConfig } from "../../src/server/config";
import { getAuth, logger } from "../../src/server/runtime";
import type { Route } from "./+types/sign-out";

// POST only (the form in the app shell). Invalidates the server session, clears the cookie
// (R6) and returns to the home page.
export async function action({ request }: Route.ActionArgs) {
  const config = getConfig();
  if (!isTrustedOrigin(request.headers, buildTrustedOrigins(config))) {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    const { headers } = await getAuth().api.signOut({
      headers: request.headers,
      returnHeaders: true,
    });
    return redirect("/", { headers });
  } catch (error) {
    logger.error("sign-out failed", {
      error: error instanceof Error ? error : new Error("unknown error"),
    });
    throw data(null, { status: 503 });
  }
}
