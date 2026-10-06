import { DEFAULT_RETURN_PATH, sanitiseReturnPath } from "./return-path";

export const SIGN_IN_PATH = "/sign-in";

export type SessionUser = { id: string; name: string; email: string; image?: string | null };

/** The minimal slice of Better Auth that the guard needs, so it can be faked in tests. */
export type SessionReader = {
  api: {
    getSession(input: { headers: Headers }): Promise<{ user: SessionUser } | null>;
  };
};

/**
 * Thrown when a request has no valid session. Framework-agnostic: the app layer turns it
 * into a redirect to `signInPath` (see app/lib/require-user.server.ts).
 */
export class AuthRequiredError extends Error {
  constructor(public readonly signInPath: string) {
    super("Authentication required");
    this.name = "AuthRequiredError";
  }
}

/** `/sign-in?returnTo=<same-origin path of the request>`; the path is always sanitised. */
export function buildSignInPath(requestUrl: string): string {
  const url = new URL(requestUrl);
  const returnTo = sanitiseReturnPath(`${url.pathname}${url.search}`);
  if (returnTo === DEFAULT_RETURN_PATH) return SIGN_IN_PATH;
  return `${SIGN_IN_PATH}?returnTo=${encodeURIComponent(returnTo)}`;
}

export async function getSessionUser(
  auth: SessionReader,
  request: Request,
): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
}

/** Returns the signed-in user or throws AuthRequiredError (R3). */
export async function requireUser(auth: SessionReader, request: Request): Promise<SessionUser> {
  const user = await getSessionUser(auth, request);
  if (!user) throw new AuthRequiredError(buildSignInPath(request.url));
  return user;
}
