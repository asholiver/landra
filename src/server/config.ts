import { z } from "zod";
import { resolveVersion } from "./health";

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === "" ? undefined : value));

const PLACEHOLDER_SECRET_FRAGMENTS = [
  "test-secret",
  "changeme",
  "change-me",
  "placeholder",
  "example",
];
const MINIMUM_DISTINCT_SECRET_CHARACTERS = 16;

function originOf(value: string | undefined): string | undefined {
  try {
    return value === undefined ? undefined : new URL(value).origin;
  } catch {
    return undefined;
  }
}

/**
 * A proxy preview forwards Google sign-in to the production deployment, which alone holds the
 * Google client secret and performs the code exchange (ADR-0002). It is recognised by: the proxy
 * secret and a production URL are set, that URL's origin differs from this deployment's own, and
 * the platform does not say this is the production deployment.
 */
function isProxyPreview(env: {
  OAUTH_PROXY_SECRET?: string;
  OAUTH_PROXY_PRODUCTION_URL?: string;
  BETTER_AUTH_URL: string;
  VERCEL_ENV?: string;
}): boolean {
  const productionOrigin = originOf(env.OAUTH_PROXY_PRODUCTION_URL);
  return (
    env.OAUTH_PROXY_SECRET !== undefined &&
    productionOrigin !== undefined &&
    productionOrigin !== originOf(env.BETTER_AUTH_URL) &&
    env.VERCEL_ENV !== "production"
  );
}

/** Rejects obviously weak or placeholder secrets (the real ones come from `openssl rand`). */
function isWeakSecret(secret: string): boolean {
  const lowered = secret.toLowerCase();
  return (
    new Set(secret).size < MINIMUM_DISTINCT_SECRET_CHARACTERS ||
    PLACEHOLDER_SECRET_FRAGMENTS.some((fragment) => lowered.includes(fragment))
  );
}

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1).pipe(z.url()),
    DATABASE_URL_UNPOOLED: optionalString.pipe(z.url().optional()),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().min(1).pipe(z.url()),
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    OAUTH_PROXY_SECRET: optionalString.pipe(z.string().min(32).optional()),
    OAUTH_PROXY_PRODUCTION_URL: optionalString.pipe(z.url().optional()),
    // Set by the hosting platform ("production" | "preview" | "development"); read as plain
    // configuration so the OAuth Proxy guard can fail closed on a production deployment.
    VERCEL_ENV: optionalString,
    GIT_SHA: optionalString,
    VERCEL_GIT_COMMIT_SHA: optionalString,
  })
  .superRefine((env, context) => {
    const hasId = env.GOOGLE_CLIENT_ID !== undefined;
    const hasSecret = env.GOOGLE_CLIENT_SECRET !== undefined;
    // F3: only a proxy preview may hold the client ID alone. Every other deployment needs both.
    const secretOptional = isProxyPreview(env);
    if (hasSecret && !hasId) {
      context.addIssue({
        code: "custom",
        path: ["GOOGLE_CLIENT_ID"],
        message: "must be set together with the other Google credential",
      });
    }
    // F3R-L1: a proxy preview must never be handed the production Google client secret.
    if (hasSecret && secretOptional) {
      context.addIssue({
        code: "custom",
        path: ["GOOGLE_CLIENT_SECRET"],
        message: "must not be set on a proxy preview (production performs the code exchange)",
      });
    }
    if (hasId && !hasSecret && !secretOptional) {
      context.addIssue({
        code: "custom",
        path: ["GOOGLE_CLIENT_SECRET"],
        message: "must be set together with the other Google credential",
      });
    }
    const addIssue = (name: string, message: string) =>
      context.addIssue({ code: "custom", path: [name], message });

    if (env.OAUTH_PROXY_SECRET !== undefined && env.OAUTH_PROXY_SECRET === env.BETTER_AUTH_SECRET) {
      addIssue("OAUTH_PROXY_SECRET", "must differ from BETTER_AUTH_SECRET");
    }
    const isProduction = env.NODE_ENV === "production";
    const isHttps = (value: string | undefined) => value?.startsWith("https://") === true;
    if (!isProduction && isHttps(env.BETTER_AUTH_URL)) {
      addIssue("BETTER_AUTH_URL", "must not be https outside production");
    }
    if (isProduction) {
      if (!isHttps(env.BETTER_AUTH_URL)) addIssue("BETTER_AUTH_URL", "must be https in production");
      if (
        env.OAUTH_PROXY_PRODUCTION_URL !== undefined &&
        !isHttps(env.OAUTH_PROXY_PRODUCTION_URL)
      ) {
        addIssue("OAUTH_PROXY_PRODUCTION_URL", "must be https in production");
      }
      for (const name of ["BETTER_AUTH_SECRET", "OAUTH_PROXY_SECRET"] as const) {
        const value = env[name];
        if (value !== undefined && isWeakSecret(value))
          addIssue(name, "is too weak for production");
      }
    }
    if (env.NODE_ENV === "production") {
      for (const name of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const) {
        if (env[name] === undefined && !(name === "GOOGLE_CLIENT_SECRET" && secretOptional)) {
          context.addIssue({ code: "custom", path: [name], message: "is required in production" });
        }
      }
    }
  });

export type AppConfig = {
  nodeEnvironment: "development" | "test" | "production";
  isProduction: boolean;
  /** True when the platform says this is the production deployment (VERCEL_ENV=production). */
  isProductionDeployment: boolean;
  databaseUrl: string;
  /** Direct (non-pooled) connection used for migrations; falls back to the app URL. */
  databaseUrlUnpooled: string;
  authSecret: string;
  authBaseUrl: string;
  /**
   * `clientSecret` is null only on a proxy preview (see isProxyPreview): production performs the
   * code exchange there, so the preview never holds the Google client secret.
   */
  google: { clientId: string; clientSecret: string | null } | null;
  oauthProxy: { secret: string; productionUrl: string } | null;
  version: string;
};

/** Thrown for invalid configuration. The message names variables, never their values. */
export class ConfigError extends Error {
  constructor(public readonly invalidVariables: string[]) {
    super(
      `Invalid configuration. Check these environment variables: ${invalidVariables.join(", ")}`,
    );
    this.name = "ConfigError";
  }
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = environmentSchema.safeParse(env);
  if (!result.success) {
    const names = new Set<string>();
    for (const issue of result.error.issues) {
      names.add(String(issue.path[0] ?? "environment"));
    }
    throw new ConfigError([...names]);
  }
  const parsed = result.data;
  return {
    nodeEnvironment: parsed.NODE_ENV,
    isProduction: parsed.NODE_ENV === "production",
    isProductionDeployment: parsed.VERCEL_ENV === "production",
    databaseUrl: parsed.DATABASE_URL,
    databaseUrlUnpooled: parsed.DATABASE_URL_UNPOOLED ?? parsed.DATABASE_URL,
    authSecret: parsed.BETTER_AUTH_SECRET,
    authBaseUrl: parsed.BETTER_AUTH_URL,
    google: parsed.GOOGLE_CLIENT_ID
      ? { clientId: parsed.GOOGLE_CLIENT_ID, clientSecret: parsed.GOOGLE_CLIENT_SECRET ?? null }
      : null,
    oauthProxy: parsed.OAUTH_PROXY_SECRET
      ? {
          secret: parsed.OAUTH_PROXY_SECRET,
          productionUrl: parsed.OAUTH_PROXY_PRODUCTION_URL ?? parsed.BETTER_AUTH_URL,
        }
      : null,
    version: resolveVersion(env),
  };
}

let cachedConfig: AppConfig | undefined;

/** Validated process configuration, loaded once. Fails fast on first use. */
export function getConfig(): AppConfig {
  cachedConfig ??= loadConfig(process.env);
  return cachedConfig;
}
