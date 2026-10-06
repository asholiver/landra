import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  // Public, prerendered (see PRERENDERED_PATHS): plain HTML and CSS, no hydration.
  index("routes/home.tsx"),
  route("sign-in", "routes/sign-in.tsx"),
  // Server-side only endpoints used by the sign-in page and the app shell.
  route("sign-in/google", "routes/sign-in.google.ts"),
  route("sign-in/status", "routes/sign-in.status.ts"),
  route("sign-out", "routes/sign-out.ts"),
  // Authenticated area: the layout loader guards `/app` and everything under it (AC8).
  route("app", "routes/app.tsx", [
    index("routes/app._index.tsx"),
    route("*", "routes/app.not-found.tsx"),
  ]),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("healthz", "routes/healthz.ts"),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
