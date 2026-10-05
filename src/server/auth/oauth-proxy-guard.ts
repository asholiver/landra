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
