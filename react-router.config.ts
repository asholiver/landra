import type { Config } from "@react-router/dev/config";

// The Vercel preset is the only Vercel-specific build code (ADR-0001). It is
// applied only when building for Vercel (VERCEL=1, set by Vercel itself and by
// `pnpm build:vercel`); every other build is a standard Node server build.
const isVercelBuild = process.env.VERCEL === "1";

const config: Config = {
  ssr: true,
  presets: isVercelBuild ? [(await import("@vercel/react-router/vite")).vercelPreset()] : [],
};

export default config;
