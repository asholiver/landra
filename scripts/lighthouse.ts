import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

// `pnpm lighthouse`: builds the standard Node build, points Lighthouse CI at the Chromium that
// Playwright already installed (no extra download), and runs the assertions in lighthouserc.cjs.
const root = resolve(import.meta.dirname, "..");

const chromePath = chromium.executablePath();
if (!existsSync(chromePath)) {
  console.error(
    `Chromium not found at ${chromePath}. Run \`pnpm exec playwright install chromium\` first.`,
  );
  process.exit(1);
}

const environment: NodeJS.ProcessEnv = { ...process.env, CHROME_PATH: chromePath };
// A VERCEL variable would switch the build to the Vercel preset, which has no Node server.
delete environment.VERCEL;

execFileSync("pnpm", ["build"], { cwd: root, env: environment, stdio: "inherit" });
execFileSync("pnpm", ["exec", "lhci", "autorun", "--config=lighthouserc.cjs"], {
  cwd: root,
  env: environment,
  stdio: "inherit",
});
