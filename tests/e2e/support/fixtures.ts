import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test as base, expect, type Page } from "@playwright/test";
import { seedAuthenticatedSession } from "../../support/session";
import {
  E2E_BASE_URL,
  e2eServerEnvironment,
  RUN_DATABASE_ENV,
  RUN_VERSION_ENV,
  SERVER_LOG_ENV,
} from "./e2e-environment";

export { expect };

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: the E2E global setup did not run.`);
  return value;
}

export type SignedInUser = { name: string; email: string };

/**
 * Seeds an allowlisted user and a real session directly in the run database (test-only fixture;
 * not an app route) and puts the signed session cookie into the browser context.
 */
async function signIn(page: Page, user: SignedInUser) {
  const session = await seedAuthenticatedSession({
    env: e2eServerEnvironment(
      requiredEnvironment(RUN_DATABASE_ENV),
      requiredEnvironment(RUN_VERSION_ENV),
    ),
    email: user.email,
    name: user.name,
  });
  await page.context().addCookies([
    {
      name: session.cookieName,
      value: session.cookieValue,
      url: E2E_BASE_URL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  return session;
}

export const test = base.extend<{
  user: SignedInUser;
  signInAsUser: () => Promise<void>;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured first argument
  user: async ({}, use) => {
    // Unique per test, so parallel tests never share a user.
    await use({ name: "Ada Lovelace", email: `ada-${randomUUID()}@example.test` });
  },
  signInAsUser: async ({ page, user }, use) => {
    await use(async () => {
      await signIn(page, user);
    });
  },
});

/** Lines the E2E web server has logged so far (parsed JSON). */
export function readServerLog(): Array<Record<string, unknown>> {
  return readFileSync(requiredEnvironment(SERVER_LOG_ENV), "utf8")
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Console errors (including CSP violations) are collected so pages can be asserted clean. */
export function collectConsoleProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  return problems;
}
