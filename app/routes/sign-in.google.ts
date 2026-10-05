import { redirect } from "react-router";
import { buildTrustedOrigins } from "../../src/server/auth/auth";
import { isTrustedOrigin } from "../../src/server/auth/origin";
import { startGoogleSignIn } from "../../src/server/auth/sign-in-flow";
import { getConfig } from "../../src/server/config";
import { getAuth, logger } from "../../src/server/runtime";
import type { Route } from "./+types/sign-in.google";

const signInErrorPath = (code: string) => `/sign-in?error=${code}`;

// POST only (a form post from the sign-in page). Starts Google sign-in server side and
// redirects to Google; failures go back to the sign-in page with a fixed error code.
export async function action({ request }: Route.ActionArgs) {
  let config: ReturnType<typeof getConfig>;
  try {
    config = getConfig();
  } catch (error) {
    logger.error("invalid configuration", {
      error: error instanceof Error ? error : new Error("unknown error"),
    });
    return redirect(signInErrorPath("failed"));
  }
  if (!isTrustedOrigin(request.headers, buildTrustedOrigins(config))) {
    return new Response("Forbidden", { status: 403 });
  }

  const form = await request.formData();
  const returnTo = form.get("returnTo");
  const result = await startGoogleSignIn({
    auth: getAuth(),
    config,
    logger,
    returnTo: typeof returnTo === "string" ? returnTo : null,
  });
  if (result.kind === "error") return redirect(signInErrorPath(result.code));
  return redirect(result.location, { headers: result.headers });
}
