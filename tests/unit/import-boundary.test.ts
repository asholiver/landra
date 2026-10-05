import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const serverRoot = resolve(import.meta.dirname, "../../src/server");
const forbidden =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["'](react-router(?:[/"'][^"']*)?|@react-router\/[^"']+|@vercel\/[^"']+)["']/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mts|js|mjs)$/.test(name) ? [path] : [];
  });
}

describe("import boundary (AC11)", () => {
  it("scans a non-trivial set of files", () => {
    expect(sourceFiles(serverRoot).length).toBeGreaterThan(5);
  });

  it("matches the patterns it is meant to forbid", () => {
    expect(forbidden.test('import { redirect } from "react-router";')).toBe(true);
    expect(forbidden.test("import x from '@vercel/functions'")).toBe(true);
    expect(forbidden.test('const m = await import("react-router")')).toBe(true);
    expect(forbidden.test('import { z } from "zod";')).toBe(false);
  });

  it("no file under src/server imports react-router or @vercel/*", () => {
    const offenders = sourceFiles(serverRoot).filter((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .some((line) => forbidden.test(line)),
    );
    expect(offenders).toEqual([]);
  });
});
