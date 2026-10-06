import { PRODUCT_NAME } from "../../src/shared/product";
import { E2E_BASE_URL } from "./support/e2e-environment";
import { collectConsoleProblems, expect, test } from "./support/fixtures";

test.describe("signed out (R3, AC8)", () => {
  test("/app redirects to /sign-in", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL("/sign-in");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  });

  test("/app/anything redirects to /sign-in, keeping a safe same-origin return path", async ({
    page,
  }) => {
    await page.goto("/app/anything?x=1");
    const url = new URL(page.url());
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("returnTo")).toBe("/app/anything?x=1");
    await expect(page.locator('input[name="returnTo"]')).toHaveValue("/app/anything?x=1");
  });

  for (const hostile of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
  ]) {
    test(`a crafted returnTo=${hostile} is ignored when asking for /app`, async ({ request }) => {
      const response = await request.get(`/app?returnTo=${encodeURIComponent(hostile)}`, {
        maxRedirects: 0,
      });
      expect(response.status()).toBe(302);
      const location = new URL(response.headers().location ?? "", E2E_BASE_URL);
      expect(location.origin).toBe(E2E_BASE_URL);
      expect(location.pathname).toBe("/sign-in");
      // The return path is the request's own same-origin path (here /app with its query string),
      // never the hostile value as a destination.
      const returnTo = location.searchParams.get("returnTo");
      if (returnTo !== null) {
        expect(returnTo.startsWith("/")).toBe(true);
        expect(returnTo.startsWith("//")).toBe(false);
        expect(returnTo.startsWith("/app")).toBe(true);
      }
    });
  }

  test("the sign-in start and sign-out routes refuse a cross-site POST", async ({ request }) => {
    for (const path of ["/sign-in/google", "/sign-out"]) {
      const crossSite = await request.post(path, {
        headers: { Origin: "https://evil.example" },
        maxRedirects: 0,
      });
      expect(crossSite.status(), path).toBe(403);
      const noOrigin = await request.post(path, { maxRedirects: 0 });
      expect(noOrigin.status(), path).toBe(403);
    }
  });
});

test.describe("signed in", () => {
  test("/app shows the shell: header, user name, sign-out and the empty state", async ({
    page,
    user,
    signInAsUser,
  }) => {
    await signInAsUser();
    const problems = collectConsoleProblems(page);
    const response = await page.goto("/app");
    expect(response?.status()).toBe(200);

    const banner = page.getByRole("banner");
    await expect(banner.getByRole("link", { name: PRODUCT_NAME })).toBeVisible();
    await expect(banner).toContainText(user.name);
    await expect(banner.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Your pipeline will appear here")).toBeVisible();
    // The page hydrates under the nonce CSP without a single console error or CSP violation.
    expect(problems).toEqual([]);
  });

  test("an unknown /app path is a 404 inside the shell", async ({ page, signInAsUser }) => {
    await signInAsUser();
    const response = await page.goto("/app/no-such-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("banner").getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });

  test("sign-out returns to / and /app then redirects to /sign-in again (R6)", async ({
    page,
    signInAsUser,
  }) => {
    await signInAsUser();
    await page.goto("/app");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { level: 1, name: PRODUCT_NAME })).toBeVisible();

    await page.goto("/app");
    await expect(page).toHaveURL("/sign-in");
    const cookies = await page.context().cookies();
    expect(cookies.filter((cookie) => cookie.name.includes("session_token"))).toEqual([]);
  });

  test("the old session cookie no longer works after sign-out (server-side invalidation)", async ({
    page,
    request,
    signInAsUser,
  }) => {
    await signInAsUser();
    const [sessionCookie] = (await page.context().cookies()).filter((cookie) =>
      cookie.name.includes("session_token"),
    );
    expect(sessionCookie).toBeDefined();
    await page.goto("/app");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL("/");

    const replay = await request.get("/app", {
      headers: { Cookie: `${sessionCookie?.name}=${sessionCookie?.value}` },
      maxRedirects: 0,
    });
    expect(replay.status()).toBe(302);
  });

  test("visiting /sign-in while signed in redirects to the sanitised returnTo", async ({
    page,
    signInAsUser,
  }) => {
    await signInAsUser();
    await page.goto("/sign-in?returnTo=%2Fapp%2Fno-such-page");
    await expect(page).toHaveURL("/app/no-such-page");

    await page.goto("/sign-in?returnTo=https%3A%2F%2Fevil.example");
    await expect(page).toHaveURL("/app");

    await page.goto("/sign-in");
    await expect(page).toHaveURL("/app");
  });
});
