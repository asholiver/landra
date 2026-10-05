import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";

// AC12: zero serious or critical violations. Moderate and minor ones are reported but not fatal.
async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(
    blocking.map((violation) => `${violation.id}: ${violation.help}`),
    "serious or critical axe violations",
  ).toEqual([]);
}

test.describe("accessibility (axe)", () => {
  test("/", async ({ page }) => {
    await page.goto("/");
    await expectNoSeriousViolations(page);
  });

  test("/sign-in", async ({ page }) => {
    await page.goto("/sign-in");
    await expectNoSeriousViolations(page);
  });

  test("/sign-in with an error message showing", async ({ page }) => {
    await page.goto("/sign-in?error=failed");
    await expect(page.getByRole("alert")).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("/app", async ({ page, signInAsUser }) => {
    await signInAsUser();
    await page.goto("/app");
    await expect(page.getByText("Your pipeline will appear here")).toBeVisible();
    await expectNoSeriousViolations(page);
  });

  test("the 404 page", async ({ page }) => {
    await page.goto("/missing");
    await expectNoSeriousViolations(page);
  });

  test("/ and /sign-in in dark mode", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    for (const path of ["/", "/sign-in", "/sign-in?error=failed"]) {
      await page.goto(path);
      await expectNoSeriousViolations(page);
    }
  });
});
