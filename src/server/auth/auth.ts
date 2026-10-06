import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { oAuthProxy } from "better-auth/plugins/oauth-proxy";
import { eq } from "drizzle-orm";
import type { AppConfig } from "../config";
import type { Database } from "../db/client";
import * as schema from "../db/schema";
import type { Logger } from "../logging/logger";
import { databaseAllowlistCheck, decideAccess } from "./access-policy";
import { createBetterAuthLogLine } from "./auth-logger";
import {
  isGoogleTokenCallPath,
  isProxyCompletionPath,
  isProxyProductionDeployment,
  isSecretlessGoogleDeployment,
  UNUSED_PREVIEW_CLIENT_SECRET,
} from "./oauth-proxy-guard";

const LOCAL_DEVELOPMENT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

/** Origins Better Auth accepts for state-changing requests (CSRF) and redirects. */
export function buildTrustedOrigins(config: AppConfig): string[] {
  const origins = new Set<string>([new URL(config.authBaseUrl).origin]);
  if (config.oauthProxy) origins.add(new URL(config.oauthProxy.productionUrl).origin);
  if (!config.isProduction) for (const origin of LOCAL_DEVELOPMENT_ORIGINS) origins.add(origin);
  return [...origins];
}

// Deliberately neutral: never reveals whether an address is on the allowlist.
const ACCESS_NOT_AVAILABLE_MESSAGE = "Access is not available for this account.";

export function createAuth(options: {
  database: Database;
  config: AppConfig;
  logger: Logger;
  /**
   * Overrides Better Auth's default (rate limiting on only when NODE_ENV is production). Tests
   * set it to exercise the limiter; leave undefined in the application.
   */
  rateLimitEnabled?: boolean;
}) {
  const { database, config, logger } = options;
  const isAllowlisted = databaseAllowlistCheck(database);
  const refuseProxyCompletion = isProxyProductionDeployment(config);
  const refuseGoogleTokenCalls = isSecretlessGoogleDeployment(config);

  return betterAuth({
    appName: "App",
    baseURL: config.authBaseUrl,
    secret: config.authSecret,
    trustedOrigins: buildTrustedOrigins(config),
    database: drizzleAdapter(database, { provider: "pg", schema }),
    // Google is the only sign-in method (ADR-0002). Registered only when configured.
    emailAndPassword: { enabled: false },
    socialProviders: config.google
      ? {
          google: {
            clientId: config.google.clientId,
            // F3: a proxy preview has no secret; Better Auth needs a non-empty value to start the
            // flow. The placeholder is never sent anywhere (see oauth-proxy-guard.ts).
            clientSecret: config.google.clientSecret ?? UNUSED_PREVIEW_CLIENT_SECRET,
            scope: ["openid", "email", "profile"],
          },
        }
      : {},
    plugins: config.oauthProxy
      ? [
          oAuthProxy({
            secret: config.oauthProxy.secret,
            productionURL: config.oauthProxy.productionUrl,
          }),
        ]
      : [],
    advanced: {
      // The rate limiter's client key (this is also Better Auth's default). Without
      // trustedProxies it uses the header only when it holds exactly ONE address; a multi-value
      // header yields no key, so all such requests share one bucket (safe, but strict). The
      // Node server overwrites the header with the socket address; Vercel sets it.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
      useSecureCookies: config.isProduction,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.isProduction,
      },
    },
    logger: { level: "info", disableColors: true, log: createBetterAuthLogLine(logger) },
    session: {
      // Explicitly off: a signed cookie cache would keep honouring a revoked session until it
      // expired. With it off every request reads the session row, so `pnpm allowlist remove`
      // takes effect on the very next request.
      cookieCache: { enabled: false },
    },
    // Limitation (L-2): this store is in memory and per instance, so on serverless each
    // instance counts separately and limits reset on cold start. Acceptable while the owner is
    // the only user; F5 (invite stage) owns moving this to a shared store.
    // No custom rules on purpose: Better Auth's built-in special rule already limits every
    // "/sign-in*" path (including /sign-in/social, the Google sign-in start) to 3 requests per
    // 10 seconds, and a custom rule would replace that stricter default.
    rateLimit: { storage: "memory", enabled: options.rateLimitEnabled },
    onAPIError: { errorURL: "/sign-in" },
    hooks: {
      // Production only forwards profiles to previews; it must never complete a proxied
      // sign-in itself (see oauth-proxy-guard.ts).
      before: createAuthMiddleware(async (context) => {
        if (refuseProxyCompletion && isProxyCompletionPath(context.path)) {
          throw new APIError("NOT_FOUND", { message: "Not found" });
        }
        // A preview without the Google client secret must not attempt a code exchange or token
        // refresh: production does the exchange, and the placeholder must never reach Google.
        if (refuseGoogleTokenCalls && isGoogleTokenCallPath(context.path)) {
          throw new APIError("NOT_FOUND", { message: "Not found" });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // BR1/BR2/R5: runs before the user row is written, so a refusal leaves no rows
          // (the account and session are only created after the user).
          before: async (candidate) => {
            const decision = await decideAccess(candidate, isAllowlisted);
            if (!decision.allowed) {
              logger.warn("sign-up refused", { reason: decision.reason });
              throw new APIError("FORBIDDEN", { message: ACCESS_NOT_AVAILABLE_MESSAGE });
            }
          },
        },
      },
      session: {
        create: {
          // Fast-path refusal for a removed or unverified user. The authoritative check is the
          // database trigger `session_requires_allowlist` (drizzle/0001), which also closes the
          // race with a concurrent `pnpm allowlist remove`. Removal itself revokes existing
          // sessions in the same transaction, so there is no surviving-session window.
          before: async (candidate) => {
            const [owner] = await database
              .select({ email: schema.user.email, emailVerified: schema.user.emailVerified })
              .from(schema.user)
              .where(eq(schema.user.id, candidate.userId))
              .limit(1);
            const decision = await decideAccess(owner ?? {}, isAllowlisted);
            if (!decision.allowed) {
              logger.warn("sign-in refused", { reason: decision.reason });
              throw new APIError("FORBIDDEN", { message: ACCESS_NOT_AVAILABLE_MESSAGE });
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
