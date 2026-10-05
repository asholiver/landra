// Lighthouse CI (AC12): the public pages, served by the local production Node build.
// Run with `pnpm lighthouse` (scripts/lighthouse.ts builds first and finds Chromium).
const port = 4174;

module.exports = {
  ci: {
    collect: {
      startServerCommand: `PORT=${port} node server/node-server.ts`,
      startServerReadyPattern: "server listening",
      url: [`http://localhost:${port}/`, `http://localhost:${port}/sign-in`],
      numberOfRuns: 3,
      // --no-sandbox is needed for Chromium in most CI containers; the pages are our own.
      settings: { chromeFlags: "--headless=new --no-sandbox" },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.98 }],
        "categories:accessibility": ["error", { minScore: 0.98 }],
        "categories:best-practices": ["error", { minScore: 0.98 }],
        // SEO is excluded ONLY because the whole site is deliberately noindex until the product
        // is named (ADR-0004, R9): Lighthouse's "is-crawlable" audit would always fail. It is
        // re-enabled in F15 when the public site is built for indexing.
        "categories:seo": "off",
      },
    },
    upload: { target: "filesystem", outputDir: ".lighthouseci" },
  },
};
