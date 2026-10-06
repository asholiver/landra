import type { AppConfig } from "../config";

/**
 * Better Auth's OAuth Proxy plugin registers two endpoints that mint a session from an
 * encrypted profile: `/callback/:id/oauth-proxy` and the deprecated `/oauth-proxy-callback`
 * (checked against better-auth 1.7.7, plugins/oauth-proxy/index.mjs). Anyone holding the proxy
 * secret could use them to sign in as any allowlisted email, so the production deployment,
 * which only ever forwards profiles to previews, must never serve them. Hook `ctx.path` is the
 * route template, not the concrete URL.
 */
const PROXY_COMPLETION_PATHS = new Set(["/callback/:id/oauth-proxy", "/oauth-proxy-callback"]);

export function isProxyCompletionPath(path: string | undefined): boolean {
  return path !== undefined && PROXY_COMPLETION_PATHS.has(path);
}

/**
 * True when this deployment is the one registered with Google (the proxy's production side).
 * Fails closed: it is production if the origins match OR the platform says so (VERCEL_ENV), so a
 * mis-set BETTER_AUTH_URL or OAUTH_PROXY_PRODUCTION_URL cannot re-open the completion endpoints.
 */
export function isProxyProductionDeployment(config: AppConfig): boolean {
  if (!config.oauthProxy) return false;
  if (config.isProductionDeployment) return true;
  return new URL(config.authBaseUrl).origin === new URL(config.oauthProxy.productionUrl).origin;
}

/**
 * Better Auth's Google provider refuses to build an authorization URL without a non-empty client
 * secret (@better-auth/core 1.7.7, social-providers/google.mjs: CLIENT_ID_AND_SECRET_REQUIRED),
 * although the secret is not part of that URL. A proxy preview holds no real secret, so it is
 * registered with this fixed, non-secret placeholder. It is only ever read by the code-exchange
 * and token-refresh calls, which `isGoogleTokenCallPath` blocks on such a deployment.
 */
export const UNUSED_PREVIEW_CLIENT_SECRET = "unused-on-proxy-preview";

/** True when this deployment was configured without the Google client secret (proxy preview). */
export function isSecretlessGoogleDeployment(config: AppConfig): boolean {
  return config.google !== null && config.google.clientSecret === null;
}

/**
 * Better Auth routes that send the client secret to Google: the plain code exchange
 * (`/callback/:id`, which the OAuth Proxy hook also uses to exchange a proxied code) and the
 * token refresh paths (`/refresh-token`, `/get-access-token`, `/account-info`). A real preview
 * sign-in never uses them (Google redirects to production, and previews request no offline
 * access), so a secretless preview refuses them and the placeholder cannot reach Google.
 */
// Reviewed against better-auth 1.7.7; tests/integration/auth-endpoints.test.ts fails when an
// upgrade adds a route, so this list is re-reviewed.
const GOOGLE_TOKEN_CALL_PATHS = new Set([
  "/callback/:id",
  "/refresh-token",
  "/get-access-token",
  "/account-info",
]);

export function isGoogleTokenCallPath(path: string | undefined): boolean {
  return path !== undefined && GOOGLE_TOKEN_CALL_PATHS.has(path);
}
