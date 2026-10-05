import type { AppConfig } from "../config";
import type { Logger } from "../logging/logger";
import type { Auth } from "./auth";
import { sanitiseReturnPath } from "./return-path";

export const SIGN_IN_ERROR_CODES = {
  /** Our own code: Google credentials are not configured in this environment. */
  notConfigured: "not_configured",
  /** Used for every other failure, so the page never reflects what the provider reported. */
  failed: "failed",
} as const;

export type SignInStart =
  | { kind: "redirect"; location: string; headers: Headers }
  | { kind: "error"; code: (typeof SIGN_IN_ERROR_CODES)[keyof typeof SIGN_IN_ERROR_CODES] };

/**
 * Starts Google sign-in server side (ADR-0002). Returns where to send the browser (Google's
 * authorisation URL plus the state cookies Better Auth set) or an error code for the sign-in
 * page. `returnTo` comes from a form field and is re-sanitised here: only a same-origin
 * relative path ever becomes the post-sign-in callback.
 */
export async function startGoogleSignIn(options: {
  auth: Auth;
  config: AppConfig;
  logger: Logger;
  returnTo: string | null | undefined;
}): Promise<SignInStart> {
  const { auth, config, logger } = options;
  if (!config.google) return { kind: "error", code: SIGN_IN_ERROR_CODES.notConfigured };

  try {
    const { headers, response } = await auth.api.signInSocial({
      body: {
        provider: "google",
        callbackURL: sanitiseReturnPath(options.returnTo),
        errorCallbackURL: "/sign-in",
        disableRedirect: true,
      },
      returnHeaders: true,
    });
    if (!response.url) throw new Error("Better Auth returned no authorisation URL");
    return { kind: "redirect", location: response.url, headers };
  } catch (error) {
    logger.error("could not start Google sign-in", {
      error: error instanceof Error ? error : new Error("unknown error"),
    });
    return { kind: "error", code: SIGN_IN_ERROR_CODES.failed };
  }
}
