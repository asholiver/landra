/**
 * Routes rendered to static HTML at build time (R2). One list, read by the React Router build
 * config, the Node server (which serves these files itself) and the tests that keep the Vercel
 * header rules in step. Every path here must work without a loader, an action or any runtime
 * configuration.
 */
export const PRERENDERED_PATHS = ["/", "/sign-in"] as const;
