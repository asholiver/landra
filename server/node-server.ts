// Standalone Node server for the standard (non-Vercel) build: `pnpm build` then `pnpm start`
// (ADR-0001 guardrail 4; R18). Node runs this file directly (type stripping), so it uses only
// erasable TypeScript, and the modules it imports with a ".ts" extension must have no
// extensionless imports of their own.
//
// Why a custom server instead of `react-router-serve`: prerendered pages and build assets are
// static files, so React Router never sees those requests. This server serves them itself and
// applies the SAME shared security headers (src/server/http/security-headers.ts). Everything
// React Router handles gets its headers, request id and log line from the root middleware.
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequestHandler } from "@react-router/express";
import compression from "compression";
import type { ErrorRequestHandler, Response } from "express";
import express from "express";
import { securityHeaders } from "../src/server/http/security-headers.ts";
import { createLogger } from "../src/server/logging/logger.ts";
import { PRERENDERED_PATHS } from "../src/shared/prerender.ts";

// react-dom and friends pick their production build from NODE_ENV when first loaded, so it is
// set before the server build is imported. An explicit NODE_ENV (tests, local runs) wins.
process.env.NODE_ENV ??= "production";

const logger = createLogger();
const clientDirectory = fileURLToPath(new URL("../build/client", import.meta.url));
const serverBuildUrl = pathToFileURL(
  fileURLToPath(new URL("../build/server/index.js", import.meta.url)),
).href;

function applySecurityHeaders(response: Response) {
  for (const [name, value] of Object.entries(securityHeaders())) response.setHeader(name, value);
}

const app = express();
app.disable("x-powered-by");
app.use(compression());

// Fingerprinted build output never changes under the same URL.
app.use(
  "/assets",
  express.static(join(clientDirectory, "assets"), {
    index: false,
    redirect: false,
    immutable: true,
    maxAge: "1y",
    setHeaders: applySecurityHeaders,
  }),
);

// Prerendered pages (R2). Served from their files, at the exact path, with no redirect to a
// trailing slash. Revalidated on every request because they are not fingerprinted.
for (const path of PRERENDERED_PATHS) {
  const file = path === "/" ? "index.html" : `${path.slice(1)}/index.html`;
  app.get(path, (_request, response, next) => {
    applySecurityHeaders(response);
    response.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    response.sendFile(file, { root: clientDirectory, dotfiles: "deny" }, (error) => {
      if (error) next(error);
    });
  });
}

// Remaining files from public/ (robots.txt, favicon, sign-in.js).
app.use(
  express.static(clientDirectory, {
    index: false,
    redirect: false,
    maxAge: "1h",
    setHeaders: applySecurityHeaders,
  }),
);

const build = await import(serverBuildUrl);
app.use(createRequestHandler({ build, mode: process.env.NODE_ENV }));

// Last resort for errors outside React Router (for example a missing static file): a fixed
// body, never a stack trace, and the same security headers.
const handleUnexpectedError: ErrorRequestHandler = (error, _request, response, next) => {
  logger.error("unhandled server error", {
    error: error instanceof Error ? error : new Error("unknown error"),
  });
  if (response.headersSent) return next(error);
  applySecurityHeaders(response);
  response.status(500).type("text/plain").send("Internal Server Error");
};
app.use(handleUnexpectedError);

const port = Number(process.env.PORT) || 3000;
const server = createServer(app).listen(port, () => {
  logger.info("server listening", { port });
});

// Graceful shutdown: stop accepting connections, let in-flight requests finish, then exit.
function shutdown(signal: string) {
  logger.info("shutting down", { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
