import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL } from "./tests/e2e/support/e2e-environment";

// E2E runs against the production Node build, never the dev server, so it exercises what ships.
// The build, the disposable run database and the web server (with explicit, non-secret test
// configuration) are all set up by globalSetup. It needs TEST_DATABASE_URL (see README).
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: E2E_BASE_URL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
