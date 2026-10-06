import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { securityHeaders } from "../../src/server/http/security-headers";
import { PRERENDERED_PATHS } from "../../src/shared/prerender";

const root = join(import.meta.dirname, "../..");

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };
const vercelConfig = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
  headers: HeaderRule[];
  regions?: string[];
  git?: { deploymentEnabled?: unknown };
};

describe("vercel.json deployment settings (R16, R17)", () => {
  it("pins functions to London (lhr1)", () => {
    expect(vercelConfig.regions).toEqual(["lhr1"]);
  });

  it("disables Vercel Git auto-deployments, so deployments only happen through CI", () => {
    expect(vercelConfig.git?.deploymentEnabled).toBe(false);
  });
});

const ASSETS_SOURCE = "/assets/(.*)";
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

// On Vercel, files served from the CDN never reach the app, so vercel.json must carry the same
// headers the app would. This test keeps it identical to the shared definition, and covers
// every statically served path (everything else is a function response, which gets its headers
// from the root middleware, so it must NOT also be listed here: no duplicated headers).
describe("vercel.json static header rules (R9, R10 on Vercel)", () => {
  it("lists exactly the statically served paths", () => {
    const publicFiles = readdirSync(join(root, "public")).map((file) => `/${file}`);
    const expected = [...PRERENDERED_PATHS, ...publicFiles, ASSETS_SOURCE].sort();
    expect(vercelConfig.headers.map((rule) => rule.source).sort()).toEqual(expected);
  });

  it.each(vercelConfig.headers.map((rule) => [rule.source, rule] as const))(
    "%s carries exactly the shared security headers",
    (source, rule) => {
      const actual = Object.fromEntries(rule.headers.map(({ key, value }) => [key, value]));
      const expected: Record<string, string> = securityHeaders();
      if (source === ASSETS_SOURCE) expected["Cache-Control"] = IMMUTABLE_CACHE;
      expect(actual).toEqual(expected);
      expect(rule.headers).toHaveLength(Object.keys(expected).length);
    },
  );
});
