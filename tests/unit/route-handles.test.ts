import { describe, expect, it } from "vitest";
import { wantsHydration, withoutHydration } from "../../app/lib/route-handles";

describe("wantsHydration (R2: public pages ship no JavaScript)", () => {
  it("is false only for routes that opt out", () => {
    expect(wantsHydration(withoutHydration)).toBe(false);
    expect(wantsHydration(undefined)).toBe(true);
    expect(wantsHydration(null)).toBe(true);
    expect(wantsHydration({})).toBe(true);
    expect(wantsHydration({ hydrate: true })).toBe(true);
    expect(wantsHydration("hydrate")).toBe(true);
  });
});
