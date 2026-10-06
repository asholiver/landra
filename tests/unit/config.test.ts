import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../src/server/config";

const validEnvironment = {
  DATABASE_URL: "postgresql://app:app@localhost:5433/app",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:5173",
};

// Random-looking (not placeholder) values, as `openssl rand -base64 32` would produce.
const STRONG_SECRET = "q7Lr2mX9vB4nT8wK1sZ5cD0hJ6gF3yPaUe+RoNi/AdE=";
const OTHER_STRONG_SECRET = "Hk3Vb8Wz1Xn6Mq9Sd2Lt7Cr4Yf0Ge5Pj+UaOiNxBvTs=";

const productionEnvironment = {
  ...validEnvironment,
  BETTER_AUTH_SECRET: STRONG_SECRET,
  BETTER_AUTH_URL: "https://app.example.com",
  NODE_ENV: "production",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
};

function messageFor(environment: Record<string, string | undefined>): string {
  try {
    loadConfig(environment);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error("expected loadConfig to throw");
}

describe("loadConfig", () => {
  it("accepts a minimal development environment without Google credentials", () => {
    const config = loadConfig(validEnvironment);
    expect(config.google).toBeNull();
    expect(config.oauthProxy).toBeNull();
    expect(config.isProduction).toBe(false);
    expect(config.databaseUrlUnpooled).toBe(validEnvironment.DATABASE_URL);
    expect(config.version).toBe("dev");
  });

  it("names the missing variable but never a value", () => {
    const message = messageFor({ ...validEnvironment, BETTER_AUTH_SECRET: undefined });
    expect(message).toContain("BETTER_AUTH_SECRET");
  });

  it("does not leak the value of an invalid variable", () => {
    const message = messageFor({ ...validEnvironment, BETTER_AUTH_SECRET: "short-secret-value" });
    expect(message).toContain("BETTER_AUTH_SECRET");
    expect(message).not.toContain("short-secret-value");
    const urlMessage = messageFor({ ...validEnvironment, DATABASE_URL: "not a url with secret" });
    expect(urlMessage).toContain("DATABASE_URL");
    expect(urlMessage).not.toContain("secret");
  });

  it("requires Google credentials in production", () => {
    const message = messageFor({ ...validEnvironment, NODE_ENV: "production" });
    expect(message).toContain("GOOGLE_CLIENT_ID");
    expect(message).toContain("GOOGLE_CLIENT_SECRET");
    expect(loadConfig(productionEnvironment).google).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
    });
  });

  it("rejects a half-configured Google provider", () => {
    const message = messageFor({ ...validEnvironment, GOOGLE_CLIENT_ID: "only-id" });
    expect(message).toContain("GOOGLE_CLIENT_SECRET");
  });

  describe("Google client secret on proxy previews (F3)", () => {
    const proxyPreviewEnvironment = {
      ...productionEnvironment,
      BETTER_AUTH_URL: "https://preview-pr-1.vercel.app",
      OAUTH_PROXY_SECRET: OTHER_STRONG_SECRET,
      OAUTH_PROXY_PRODUCTION_URL: "https://app.example.com",
      VERCEL_ENV: "preview",
      GOOGLE_CLIENT_SECRET: undefined,
    };

    it("accepts the client ID alone on a proxy preview, with no secret held", () => {
      expect(loadConfig(proxyPreviewEnvironment).google).toEqual({
        clientId: "client-id",
        clientSecret: null,
      });
    });

    it("rejects a Google client secret on a proxy preview, naming it but never its value", () => {
      const message = messageFor({
        ...proxyPreviewEnvironment,
        GOOGLE_CLIENT_SECRET: "super-secret-value",
      });
      expect(message).toContain("GOOGLE_CLIENT_SECRET");
      expect(message).not.toContain("super-secret-value");
    });

    it("does not affect local development: both credentials are accepted outside a proxy preview", () => {
      const config = loadConfig({
        ...validEnvironment,
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
      });
      expect(config.google).toEqual({ clientId: "client-id", clientSecret: "client-secret" });
    });

    it("still requires the client ID on a proxy preview in production mode", () => {
      expect(messageFor({ ...proxyPreviewEnvironment, GOOGLE_CLIENT_ID: undefined })).toContain(
        "GOOGLE_CLIENT_ID",
      );
    });

    it("rejects a secret without an ID on a proxy preview", () => {
      const message = messageFor({
        ...proxyPreviewEnvironment,
        GOOGLE_CLIENT_ID: undefined,
        GOOGLE_CLIENT_SECRET: "client-secret",
      });
      expect(message).toContain("GOOGLE_CLIENT_ID");
    });

    it("rejects the client ID alone when VERCEL_ENV is production", () => {
      expect(messageFor({ ...proxyPreviewEnvironment, VERCEL_ENV: "production" })).toContain(
        "GOOGLE_CLIENT_SECRET",
      );
    });

    it("rejects the client ID alone on the production deployment itself", () => {
      const message = messageFor({
        ...productionEnvironment,
        GOOGLE_CLIENT_SECRET: undefined,
        OAUTH_PROXY_SECRET: OTHER_STRONG_SECRET,
        OAUTH_PROXY_PRODUCTION_URL: "https://app.example.com",
      });
      expect(message).toContain("GOOGLE_CLIENT_SECRET");
    });

    it("rejects the client ID alone when the proxy production URL has the same origin", () => {
      const message = messageFor({
        ...proxyPreviewEnvironment,
        BETTER_AUTH_URL: "https://app.example.com",
        OAUTH_PROXY_PRODUCTION_URL: "https://app.example.com/",
      });
      expect(message).toContain("GOOGLE_CLIENT_SECRET");
    });

    it("rejects the client ID alone on a non-proxy deployment, in production and outside it", () => {
      const withoutProxy = {
        ...proxyPreviewEnvironment,
        OAUTH_PROXY_SECRET: undefined,
        OAUTH_PROXY_PRODUCTION_URL: undefined,
      };
      expect(messageFor(withoutProxy)).toContain("GOOGLE_CLIENT_SECRET");
      expect(
        messageFor({
          ...validEnvironment,
          GOOGLE_CLIENT_ID: "only-id",
          OAUTH_PROXY_PRODUCTION_URL: "https://app.example.com",
        }),
      ).toContain("GOOGLE_CLIENT_SECRET");
    });

    it("rejects the client ID alone when a production URL is set without the proxy secret", () => {
      expect(messageFor({ ...proxyPreviewEnvironment, OAUTH_PROXY_SECRET: undefined })).toContain(
        "GOOGLE_CLIENT_SECRET",
      );
    });
  });

  it("treats empty strings as unset", () => {
    const config = loadConfig({
      ...validEnvironment,
      GOOGLE_CLIENT_ID: "",
      OAUTH_PROXY_SECRET: "",
    });
    expect(config.google).toBeNull();
    expect(config.oauthProxy).toBeNull();
  });

  it("enables the OAuth proxy only when its secret is set, defaulting the production URL", () => {
    const config = loadConfig({ ...validEnvironment, OAUTH_PROXY_SECRET: "p".repeat(32) });
    expect(config.oauthProxy).toEqual({
      secret: "p".repeat(32),
      productionUrl: validEnvironment.BETTER_AUTH_URL,
    });
    expect(messageFor({ ...validEnvironment, OAUTH_PROXY_SECRET: "tiny" })).toContain(
      "OAUTH_PROXY_SECRET",
    );
  });

  it("takes the version from GIT_SHA, then the Vercel commit SHA", () => {
    expect(loadConfig({ ...validEnvironment, VERCEL_GIT_COMMIT_SHA: "abc" }).version).toBe("abc");
    expect(
      loadConfig({ ...validEnvironment, GIT_SHA: "def", VERCEL_GIT_COMMIT_SHA: "abc" }).version,
    ).toBe("def");
  });
});

describe("URL scheme rules (M-3)", () => {
  it("accepts http localhost outside production", () => {
    expect(loadConfig(validEnvironment).authBaseUrl).toBe("http://localhost:5173");
    expect(loadConfig({ ...validEnvironment, NODE_ENV: "test" }).isProduction).toBe(false);
  });

  it("rejects an https BETTER_AUTH_URL outside production", () => {
    for (const NODE_ENV of ["development", "test"]) {
      const message = messageFor({
        ...validEnvironment,
        NODE_ENV,
        BETTER_AUTH_URL: "https://app.example.com",
      });
      expect(message).toContain("BETTER_AUTH_URL");
    }
  });

  it("accepts https URLs in production", () => {
    const config = loadConfig({
      ...productionEnvironment,
      OAUTH_PROXY_SECRET: OTHER_STRONG_SECRET,
      OAUTH_PROXY_PRODUCTION_URL: "https://app.example.com",
    });
    expect(config.isProduction).toBe(true);
  });

  it("rejects http URLs in production, naming only the variable", () => {
    const base = messageFor({
      ...productionEnvironment,
      BETTER_AUTH_URL: "http://app.example.com",
    });
    expect(base).toContain("BETTER_AUTH_URL");
    expect(base).not.toContain("app.example.com");
    const proxy = messageFor({
      ...productionEnvironment,
      OAUTH_PROXY_SECRET: OTHER_STRONG_SECRET,
      OAUTH_PROXY_PRODUCTION_URL: "http://app.example.com",
    });
    expect(proxy).toContain("OAUTH_PROXY_PRODUCTION_URL");
  });
});

describe("secret rules (L-3)", () => {
  it("rejects an OAuth proxy secret equal to BETTER_AUTH_SECRET", () => {
    const message = messageFor({
      ...validEnvironment,
      BETTER_AUTH_SECRET: STRONG_SECRET,
      OAUTH_PROXY_SECRET: STRONG_SECRET,
    });
    expect(message).toContain("OAUTH_PROXY_SECRET");
    expect(message).not.toContain(STRONG_SECRET);
  });

  it("still requires at least 32 characters for the proxy secret", () => {
    expect(
      messageFor({ ...validEnvironment, OAUTH_PROXY_SECRET: OTHER_STRONG_SECRET.slice(0, 31) }),
    ).toContain("OAUTH_PROXY_SECRET");
  });

  it.each([
    ["few distinct characters", "ab".repeat(24)],
    ["a placeholder fragment", "integration-test-secret-0123456789abcdef"],
    ["the word changeme", "Zq8!changeme-Zq8!changeme-Zq8!changeme"],
  ])("rejects a weak secret in production: %s", (_label, weak) => {
    const betterAuth = messageFor({ ...productionEnvironment, BETTER_AUTH_SECRET: weak });
    expect(betterAuth).toContain("BETTER_AUTH_SECRET");
    expect(betterAuth).not.toContain(weak);
    const proxy = messageFor({ ...productionEnvironment, OAUTH_PROXY_SECRET: weak });
    expect(proxy).toContain("OAUTH_PROXY_SECRET");
  });

  it("accepts the same weak-looking secret outside production (local and test fixtures)", () => {
    expect(
      loadConfig({
        ...validEnvironment,
        BETTER_AUTH_SECRET: "integration-test-secret-0123456789abcdef",
      }).authSecret,
    ).toContain("test-secret");
  });

  it("accepts strong, distinct secrets in production", () => {
    expect(
      loadConfig({ ...productionEnvironment, OAUTH_PROXY_SECRET: OTHER_STRONG_SECRET }).oauthProxy,
    ).not.toBeNull();
  });
});
