import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listAllowedEmails } from "../../src/server/allowlist/allowlist";
import { createTestRuntime, integrationDatabaseUrl } from "./helpers";

const runtime = createTestRuntime();
afterAll(() => runtime.pool.end());

function script(...args: string[]) {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/allowlist.ts", ...args], {
    cwd: resolve(import.meta.dirname, "../.."),
    env: { ...process.env, DATABASE_URL: integrationDatabaseUrl() },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

describe("allowlist script (R13)", () => {
  beforeEach(async () => {
    for (const email of await listAllowedEmails(runtime.db)) script("remove", email);
  });

  it("adds a normalised email, lists it, and removes it", async () => {
    expect(script("add", "  Owner@Example.COM ").status).toBe(0);
    expect(script("list").stdout).toBe("owner@example.com");
    expect(await listAllowedEmails(runtime.db)).toEqual(["owner@example.com"]);
    expect(script("add", "owner@example.com").stdout).toBe(
      "owner@example.com is already on the approved list.",
    );
    expect(script("remove", "OWNER@example.com").stdout).toBe(
      "Removed owner@example.com from the approved list and revoked 0 active session(s).",
    );
    expect(script("list").stdout).toBe("");
  });

  it("rejects invalid emails and bad usage with a non-zero exit", () => {
    expect(script("add", "nope").status).toBe(2);
    expect(script("frobnicate").status).toBe(2);
    expect(script("add").status).toBe(2);
  });
});
