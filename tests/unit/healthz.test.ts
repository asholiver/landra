import { describe, expect, it } from "vitest";
import { loader } from "../../app/routes/healthz";
import { healthPayload, resolveVersion } from "../../src/server/health";

describe("healthz (R7)", () => {
  it("reports status and version without touching the database", async () => {
    const response = loader();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", version: expect.any(String) });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("resolves the version from GIT_SHA, then the Vercel SHA, then dev", () => {
    expect(resolveVersion({ GIT_SHA: "abc123" })).toBe("abc123");
    expect(resolveVersion({ VERCEL_GIT_COMMIT_SHA: "def456" })).toBe("def456");
    expect(resolveVersion({})).toBe("dev");
    expect(healthPayload("v")).toEqual({ status: "ok", version: "v" });
  });
});
