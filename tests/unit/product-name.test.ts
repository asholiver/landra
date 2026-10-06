import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCT_NAME } from "../../src/shared/product";

const root = join(import.meta.dirname, "../..");
const SKIPPED_DIRECTORIES = new Set(["node_modules", "build", ".react-router", ".vercel"]);
const PRODUCT_MODULE = join("src", "shared", "product.ts");
// Assembled at run time so this file does not itself contain either string.
const WORKING_LABEL = ["Job", "Search", "Copilot"].join(" ");
const REPOSITORY_NAME = ["lan", "dra"].join("");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if (SKIPPED_DIRECTORIES.has(entry)) return [];
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

function filesIn(...directories: string[]): string[] {
  return directories.flatMap((directory) => sourceFiles(join(root, directory)));
}

describe("product name (R8, AC14)", () => {
  it("is the working label, defined by the product module", () => {
    expect(PRODUCT_NAME).toBe(WORKING_LABEL);
  });

  it("appears in exactly one source file: the product module", () => {
    const sources = [
      ...filesIn("app", "src", "scripts", "server", "public", "tests"),
      ...[
        "react-router.config.ts",
        "vite.config.ts",
        "playwright.config.ts",
        "vitest.config.ts",
      ].map((file) => join(root, file)),
    ];
    const containing = sources
      .filter((file) => readFileSync(file, "utf8").includes(WORKING_LABEL))
      .map((file) => relative(root, file));
    expect(containing).toEqual([PRODUCT_MODULE]);
  });

  it("never uses the repository's working name in UI copy", () => {
    const uiFiles = filesIn("app", "public", join("src", "shared"));
    expect(uiFiles.length).toBeGreaterThan(5);
    const offenders = uiFiles
      .filter((file) => readFileSync(file, "utf8").toLowerCase().includes(REPOSITORY_NAME))
      .map((file) => relative(root, file));
    expect(offenders).toEqual([]);
  });
});
