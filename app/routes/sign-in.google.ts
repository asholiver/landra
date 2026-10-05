import { handleGoogleSignIn } from "../../src/server/auth/sign-in-flow";
import { getConfig } from "../../src/server/config";
import { getAuth, logger } from "../../src/server/runtime";
import type { Route } from "./+types/sign-in.google";

// POST only (a form post from the sign-in page). All the logic (origin check, body limit,
// returnTo sanitising, Better Auth's rate-limited handler) lives in src/server/auth/sign-in-flow.
export async function action({ request }: Route.ActionArgs) {
  let config: ReturnType<typeof getConfig>;
  try {
    config = getConfig();
  } catch (error) {
    logger.error("invalid configuration", {
      error: error instanceof Error ? error : new Error("unknown error"),
    });
    return new Response(null, { status: 302, headers: { Location: "/sign-in?error=failed" } });
  }
  return handleGoogleSignIn({ request, auth: getAuth(), config, logger });
}
