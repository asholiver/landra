import type { AppConfig } from "../config";
import type { Logger } from "../logging/logger";
import { type Auth, buildTrustedOrigins } from "./auth";
import { isTrustedOrigin } from "./origin";
import { sanitiseReturnPath } from "./return-path";

export const SIGN_IN_ERROR_CODES = {
  /** Our own code: Google credentials are not configured in this environment. */
  notConfigured: "not_configured",
  /** Used for every other failure, so the page never reflects what the provider reported. */
  failed: "failed",
} as const;

/** The sign-in form has one short field, so anything larger is not a legitimate request. */
export const MAX_SIGN_IN_BODY_BYTES = 4096;

const SOCIAL_SIGN_IN_PATH = "/api/auth/sign-in/social";

function redirectTo(location: string, setCookies: string[] = []): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of setCookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

const signInError = (code: (typeof SIGN_IN_ERROR_CODES)[keyof typeof SIGN_IN_ERROR_CODES]) =>
  redirectTo(`/sign-in?error=${code}`);

const tooLarge = () => new Response("Request too large", { status: 413 });

/**
 * Reads the request body as text, but never more than `limit` bytes. Returns null when the body
 * is too large, or when its length is missing or invalid (checked before anything is read).
 * A body that turns out larger than it declared is cut off while streaming.
 */
async function readBoundedBody(request: Request, limit: number): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared === null || !/^\d{1,9}$/.test(declared) || Number(declared) > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Starts Google sign-in (ADR-0002) for the sign-in form post. In order:
 *  1. CSRF: the Origin must be a trusted origin (403).
 *  2. The body is size-limited before it is parsed (413).
 *  3. `returnTo` is re-sanitised; only a same-origin relative path becomes the callback.
 *  4. The request goes through Better Auth's HTTP handler, so Better Auth's own rate limiter
 *     applies (429). The client's IP is taken from the `x-forwarded-for` header: the Node
 *     server overwrites it with the socket address, and Vercel sets it itself.
 *  5. Better Auth's state cookies are forwarded and the browser is sent to Google.
 */
export async function handleGoogleSignIn(options: {
  request: Request;
  auth: Auth;
  config: AppConfig;
  logger: Logger;
}): Promise<Response> {
  const { request, auth, config, logger } = options;

  if (!isTrustedOrigin(request.headers, buildTrustedOrigins(config))) {
    return new Response("Forbidden", { status: 403 });
  }
  const body = await readBoundedBody(request, MAX_SIGN_IN_BODY_BYTES);
  if (body === null) return tooLarge();

  if (!config.google) return signInError(SIGN_IN_ERROR_CODES.notConfigured);

  const isForm = (request.headers.get("content-type") ?? "").includes(
    "application/x-www-form-urlencoded",
  );
  const submittedReturnTo = isForm ? new URLSearchParams(body).get("returnTo") : null;

  const headers = new Headers({
    "content-type": "application/json",
    origin: request.headers.get("origin") ?? "",
  });
  for (const name of ["cookie", "x-forwarded-for", "user-agent"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  try {
    const response = await auth.handler(
      new Request(new URL(SOCIAL_SIGN_IN_PATH, config.authBaseUrl), {
        method: "POST",
        headers,
        body: JSON.stringify({
          provider: "google",
          callbackURL: sanitiseReturnPath(submittedReturnTo),
          errorCallbackURL: "/sign-in",
          disableRedirect: true,
        }),
      }),
    );
    if (response.status === 429) {
      const retryAfter = response.headers.get("x-retry-after");
      return new Response("Too many sign-in attempts. Please wait a moment and try again.", {
        status: 429,
        headers: retryAfter ? { "Retry-After": retryAfter } : {},
      });
    }
    const result = (await response.json().catch(() => null)) as { url?: unknown } | null;
    if (!response.ok || typeof result?.url !== "string") {
      logger.error("could not start Google sign-in", { status: response.status });
      return signInError(SIGN_IN_ERROR_CODES.failed);
    }
    return redirectTo(result.url, response.headers.getSetCookie());
  } catch (error) {
    logger.error("could not start Google sign-in", {
      error: error instanceof Error ? error : new Error("unknown error"),
    });
    return signInError(SIGN_IN_ERROR_CODES.failed);
  }
}
