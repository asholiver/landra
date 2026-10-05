import type { Config } from "@react-router/dev/config";
import { PRERENDERED_PATHS } from "./src/shared/prerender";

// The Vercel preset is the only Vercel-specific build code (ADR-0001). It is
// applied only when building for Vercel (VERCEL=1, set by Vercel itself and by
// `pnpm build:vercel`); every other build is a standard Node server build.
const isVercelBuild = process.env.VERCEL === "1";

const config: Config = {
  ssr: true,
  // R2: these routes become static HTML files at build time.
  prerender: [...PRERENDERED_PATHS],
  // Root middleware applies the security headers, request id and request log to every dynamic
  // response (src/server/http/request-policy.ts).
  future: { v8_middleware: true },
  presets: isVercelBuild ? [(await import("@vercel/react-router/vite")).vercelPreset()] : [],
};

export default config;
