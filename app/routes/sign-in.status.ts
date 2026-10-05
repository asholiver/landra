import { sanitiseReturnPath } from "../../src/server/auth/return-path";
import { getSessionUser } from "../../src/server/auth/session";
import { getAuth, logger } from "../../src/server/runtime";
import type { Route } from "./+types/sign-in.status";

// Used by the prerendered sign-in page: a visitor who is already signed in is sent straight to
// the (re-sanitised) return path. Any failure answers "not signed in" so the page stays usable.
export async function loader({ request }: Route.LoaderArgs) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const user = await getSessionUser(getAuth(), request);
    if (user) {
      const redirectTo = sanitiseReturnPath(new URL(request.url).searchParams.get("returnTo"));
      return Response.json({ signedIn: true, redirectTo }, { headers });
    }
  } catch (error) {
    logger.error("could not check the session", {
      error: error instanceof Error ? error : new Error("unknown error"),
    });
  }
  return Response.json({ signedIn: false }, { headers });
}
