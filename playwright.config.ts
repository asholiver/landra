import { defineConfig, devices } from "@playwright/test";

const port = 4173;
const baseURL = `http://localhost:${port}`;

// E2E runs against the production Node build (`pnpm build` then `pnpm start`),
// never the dev server, so it exercises what ships.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm build && pnpm start",
    url: `${baseURL}/`,
    env: { PORT: String(port) },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
