import { PRODUCT_NAME } from "../../src/shared/product";
import { collectConsoleProblems, expect, test } from "./support/fixtures";

const REPOSITORY_NAME = ["lan", "dra"].join("");

test.describe("public pages (R2, R8, R9)", () => {
  test("/ renders the placeholder page with the product label and a sign-in link", async ({
    page,
  }) => {
    const problems = collectConsoleProblems(page);
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(PRODUCT_NAME);
    await expect(page.getByRole("heading", { level: 1, name: PRODUCT_NAME })).toBeVisible();
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/sign-in");
    expect(problems).toEqual([]);
  });

  test("/sign-in renders a native Continue with Google button", async ({ page }) => {
    const problems = collectConsoleProblems(page);
    const response = await page.goto("/sign-in");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    const button = page.getByRole("button", { name: "Continue with Google" });
    await expect(button).toBeVisible();
    expect(await button.evaluate((element) => element.tagName)).toBe("BUTTON");
    expect(problems).toEqual([]);
  });

  test("the button is reachable and operable by keyboard, with a visible focus ring", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await page.keyboard.press("Tab"); // skip link
    await page.keyboard.press("Tab"); // brand link
    await page.keyboard.press("Tab"); // button
    const button = page.getByRole("button", { name: "Continue with Google" });
    await expect(button).toBeFocused();
    const outline = await button.evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outline).not.toBe("none");
  });

  test("public pages ship no inline script and no framework JavaScript (R2)", async ({
    request,
  }) => {
    const home = await (await request.get("/")).text();
    expect(home).not.toContain("<script");
    expect(home).not.toContain("modulepreload");

    const signIn = await (await request.get("/sign-in")).text();
    const scripts = signIn.match(/<script[^>]*>/g) ?? [];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('src="/sign-in.js"');
    expect(signIn).not.toContain("modulepreload");
  });

  test("every page carries the noindex meta tag, and none uses the repository's name (R8, R9)", async ({
    request,
  }) => {
    for (const path of ["/", "/sign-in", "/no-such-page"]) {
      const html = await (await request.get(path)).text();
      expect(html).toContain('<meta name="robots" content="noindex, nofollow"/>');
      expect(html.toLowerCase()).not.toContain(REPOSITORY_NAME);
    }
  });

  test("robots.txt allows crawling so the noindex can be seen", async ({ request }) => {
    const response = await request.get("/robots.txt");
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toMatch(/^Allow: \/$/m);
    expect(body).not.toMatch(/^Disallow: \/\s*$/m);
  });

  test("an unknown path shows a 404 page without leaking internals", async ({ page }) => {
    const response = await page.goto("/definitely/not/here");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    const html = await page.content();
    expect(html).not.toMatch(/at .*\(.*:\d+:\d+\)/);
  });
});

test.describe("sign-in page behaviour", () => {
  test("Continue with Google says Google is not configured, and offers no other way in", async ({
    page,
  }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page).toHaveURL("/sign-in?error=not_configured");
    await expect(page.getByRole("alert")).toHaveText(
      "Google sign-in is not configured in this environment.",
    );
    await expect(page.getByRole("button")).toHaveCount(1);
    await expect(page.getByRole("textbox")).toHaveCount(0);
  });

  test("shows a fixed neutral message for a provider error, never echoing the raw value", async ({
    page,
  }) => {
    const hostile = "<img src=x onerror=alert(1)>please-sign-in";
    await page.goto(`/sign-in?error=${encodeURIComponent(hostile)}`);
    const alert = page.getByRole("alert");
    await expect(alert).toHaveCount(1);
    await expect(alert).toContainText("We could not sign you in.");
    const html = await page.content();
    expect(html).not.toContain("please-sign-in");
    expect(html).not.toContain("onerror");
  });

  test("shows the loading state while the sign-in request is in flight", async ({ page }) => {
    // Running page.evaluate (or a locator query) while a navigation is pending is unreliable, so
    // the page reports its own state, through an exposed binding, at the moment of submission.
    let stateAtSubmit: unknown;
    await page.exposeFunction("reportSignInState", (state: unknown) => {
      stateAtSubmit = state;
    });
    await page.addInitScript(() => {
      document.addEventListener("submit", () => {
        const button = document.querySelector("[data-sign-in-button]") as HTMLButtonElement | null;
        const status = document.querySelector("[data-sign-in-status]");
        (window as unknown as { reportSignInState: (state: unknown) => void }).reportSignInState({
          disabled: button?.disabled,
          busy: button?.getAttribute("aria-busy"),
          status: status?.textContent,
          statusHidden: status?.hasAttribute("hidden"),
        });
      });
    });
    await page.goto("/sign-in");
    // sign-in.js is deferred: wait until its submit handler is attached, or the click could
    // submit the form natively and the busy state would never appear.
    await page.locator('[data-sign-in-form][data-enhanced="true"]').waitFor({ state: "attached" });
    // Hold the request open (aborted at the end of the test by closing the page).
    await page.route("**/sign-in/google", () => {});
    await page.getByRole("button", { name: "Continue with Google" }).click({ noWaitAfter: true });
    await expect
      .poll(() => stateAtSubmit)
      .toEqual({
        disabled: true,
        busy: "true",
        status: "Redirecting to Google…",
        statusHidden: false,
      });
  });

  test("carries returnTo into the form for the server to re-sanitise", async ({ page }) => {
    await page.goto("/sign-in?returnTo=%2Fapp%2Fsomewhere");
    await expect(page.locator('input[name="returnTo"]')).toHaveValue("/app/somewhere");
  });
});
