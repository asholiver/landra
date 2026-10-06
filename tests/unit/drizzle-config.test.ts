import { afterEach, describe, expect, it, vi } from "vitest";

async function configuredUrl(env: { DATABASE_URL_UNPOOLED: string; DATABASE_URL: string }) {
  vi.stubEnv("DATABASE_URL_UNPOOLED", env.DATABASE_URL_UNPOOLED);
  vi.stubEnv("DATABASE_URL", env.DATABASE_URL);
  vi.resetModules();
  const { default: config } = await import("../../drizzle.config");
  return (config as { dbCredentials: { url: string } }).dbCredentials.url;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("drizzle.config.ts database URL", () => {
  it("prefers DATABASE_URL_UNPOOLED", async () => {
    expect(
      await configuredUrl({
        DATABASE_URL_UNPOOLED: "postgresql://app@localhost:5433/direct",
        DATABASE_URL: "postgresql://app@localhost:5433/pooled",
      }),
    ).toBe("postgresql://app@localhost:5433/direct");
  });

  it("falls back to DATABASE_URL when DATABASE_URL_UNPOOLED is empty, like scripts/migrate.ts", async () => {
    expect(
      await configuredUrl({
        DATABASE_URL_UNPOOLED: "",
        DATABASE_URL: "postgresql://app@localhost:5433/pooled",
      }),
    ).toBe("postgresql://app@localhost:5433/pooled");
  });
});
