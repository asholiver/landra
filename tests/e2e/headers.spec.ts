import { securityHeaders } from "../../src/server/http/security-headers";
import { RUN_VERSION_ENV } from "./support/e2e-environment";
import { expect, readServerLog, test } from "./support/fixtures";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function expectSecurityHeaders(
  headers: Record<string, string>,
  { nonce }: { nonce: "required" | "absent" },
) {
  expect(headers["x-robots-tag"]).toBe("noindex, nofollow");
  expect(headers["strict-transport-security"]).toMatch(/^max-age=\d{6,}/);
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toBe(securityHeaders()["Permissions-Policy"]);
  const csp = headers["content-security-policy"] ?? "";
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("unsafe-inline");
  expect(csp).not.toContain("unsafe-eval");
  if (nonce === "required") expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
  else expect(csp).toContain("script-src 'self';");
}

test.describe("security headers on every response (R9, R10, AC6)", () => {
  test("prerendered pages (served as static files)", async ({ request }) => {
    for (const path of ["/", "/sign-in"]) {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      expectSecurityHeaders(response.headers(), { nonce: "absent" });
    }
  });

  test("a build asset, public files and the sign-in script", async ({ request }) => {
    const home = await (await request.get("/")).text();
    const stylesheet = home.match(/href="(\/assets\/[^"]+\.css)"/)?.[1];
    expect(stylesheet).toBeDefined();
    for (const path of [stylesheet ?? "", "/robots.txt", "/favicon.svg", "/sign-in.js"]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expectSecurityHeaders(response.headers(), { nonce: "absent" });
    }
    const asset = await request.get(stylesheet ?? "");
    expect(asset.headers()["cache-control"]).toContain("immutable");
  });

  test("/healthz and the auth endpoints", async ({ request }) => {
    const health = await request.get("/healthz");
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({
      status: "ok",
      version: process.env[RUN_VERSION_ENV],
    });
    expectSecurityHeaders(health.headers(), { nonce: "required" });

    const session = await request.get("/api/auth/get-session");
    expect(session.status()).toBe(200);
    expectSecurityHeaders(session.headers(), { nonce: "required" });
  });

  test("redirects, the 404 page and the signed-in app", async ({ page, request, signInAsUser }) => {
    const redirect = await request.get("/app", { maxRedirects: 0 });
    expect(redirect.status()).toBe(302);
    expectSecurityHeaders(redirect.headers(), { nonce: "required" });

    const notFound = await request.get("/nothing-here");
    expect(notFound.status()).toBe(404);
    expectSecurityHeaders(notFound.headers(), { nonce: "required" });

    await signInAsUser();
    const response = await page.goto("/app");
    expect(response?.status()).toBe(200);
    expectSecurityHeaders((await response?.allHeaders()) ?? {}, { nonce: "required" });
  });
});

test.describe("caching of authenticated pages", () => {
  test("every /app response (document, data, 404 inside the shell) is private, no-store", async ({
    page,
    signInAsUser,
  }) => {
    await signInAsUser();
    const document = await page.goto("/app");
    expect(document?.status()).toBe(200);
    expect(document?.headers()["cache-control"]).toBe("private, no-store");

    const data = await page.request.get("/app.data");
    expect(data.status()).toBe(200);
    expect(data.headers()["cache-control"]).toBe("private, no-store");

    const missing = await page.goto("/app/no-such-page");
    expect(missing?.status()).toBe(404);
    expect(missing?.headers()["cache-control"]).toBe("private, no-store");
  });
});

test.describe("CSP nonce on dynamic HTML", () => {
  test("every inline script on /app carries the response's nonce and nonces differ per request", async ({
    page,
    signInAsUser,
  }) => {
    await signInAsUser();
    const nonces: string[] = [];
    for (let visit = 0; visit < 2; visit += 1) {
      const response = await page.goto("/app");
      const csp = (await response?.headerValue("content-security-policy")) ?? "";
      const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
      expect(nonce).toBeDefined();
      nonces.push(nonce ?? "");

      const html = (await response?.text()) ?? "";
      const inlineScripts = (html.match(/<script(?![^>]*\ssrc=)[^>]*>/g) ?? []).filter(Boolean);
      expect(inlineScripts.length).toBeGreaterThan(0);
      for (const tag of inlineScripts) expect(tag).toContain(`nonce="${nonce}"`);
    }
    expect(nonces[0]).not.toBe(nonces[1]);
  });
});

test.describe("request id and logs (R11)", () => {
  test("dynamic responses get a unique X-Request-Id, and the log line carries it", async ({
    request,
  }) => {
    const first = await request.get("/healthz", { headers: { "X-Request-Id": "attacker-chosen" } });
    const second = await request.get("/healthz");
    const firstId = first.headers()["x-request-id"] ?? "";
    expect(firstId).toMatch(UUID);
    expect(firstId).not.toBe("attacker-chosen");
    expect(second.headers()["x-request-id"]).not.toBe(firstId);

    await expect
      .poll(() => readServerLog().find((line) => line.requestId === firstId), { timeout: 5000 })
      .toMatchObject({ method: "GET", route: "/healthz", status: 200 });
    const entry = readServerLog().find((line) => line.requestId === firstId);
    expect(typeof entry?.durationMs).toBe("number");
  });

  test("logs omit query strings and the user's email", async ({
    page,
    request,
    user,
    signInAsUser,
  }) => {
    await request.get("/api/auth/get-session?token=QUERYSECRET1234567890");
    await signInAsUser();
    await page.goto("/app");
    await expect
      .poll(() => readServerLog().filter((line) => line.route === "/app").length)
      .toBeGreaterThan(0);
    const raw = JSON.stringify(readServerLog());
    expect(raw).not.toContain("QUERYSECRET");
    expect(raw).not.toContain(user.email);
  });
});
