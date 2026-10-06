# ADR-0001: React Router v7 (framework mode) on Vercel Hobby, with portability guardrails
## Status
Accepted (Ashley Oliver, 2026-10-05)
## Context
The product needs one codebase that serves:
- a public, SEO-friendly marketing site (pre-rendered, minimal JS, Lighthouse ≥98);
- an authenticated application where SEO is irrelevant;
- server-side code for the database, auth and, later, AI calls.

Constraints:
- Stack preference: TypeScript, React, Node.js, Vite-era tooling.
- Infrastructure at or near £0 while usage is low.
- Portability and minimal vendor lock-in.

Facts verified 2026-10-05:
- Vercel Hobby is free but non-commercial only: no payments, no selling a product or service, no ads. Donations are allowed.
- Hobby allowance: 1M function invocations/month, 4 Active CPU-hours, 100 GB transfer, 300s maximum duration, a single function region, 1 hour of runtime logs.
- Exceeding a Hobby limit pauses the feature rather than billing.
## Decision
- Framework: React Router v7 in framework mode, built on Vite.
  - Public routes are pre-rendered at build time.
  - App routes are server-rendered behind auth, with client interactivity.
- Hosting: Vercel Hobby with the `@vercel/react-router` preset. Functions are pinned to London (`lhr1`) to sit beside the database (ADR-0003).
- Portability guardrails (binding on all features):
  1. No Vercel-proprietary application services (KV, Blob, Edge Config, Cron, Workflows, Vercel Analytics) in application code paths. Vercel-specific code is limited to build config (the preset) and `vercel.json`.
  2. Business logic and data access live in framework-agnostic TypeScript modules under `src/server/`. Route `loader`/`action` functions stay thin: parse input, call a module, return a response.
  3. Use standard Web APIs (Request/Response) and standard Postgres only.
  4. CI also builds the app for a standard Node deployment (React Router Node server without the Vercel preset) and smoke-tests that it starts and serves the home page.
## Why
- A full-stack React framework is justified by the public site. A plain SPA would need bolted-on prerendering or a second codebase.
- React Router v7 keeps the request/response mental model close to React + Node, has an official Node adapter, and is less coupled to its host than Next.js.
- Vercel gives free per-PR previews and no surprise bills.
## Alternatives considered
### Next.js (App Router) on Vercel
Largest ecosystem and Vercel-native. Rejected because Server Components and caching semantics move further from the preferred mental model, and some features need extra work away from Vercel, which works against portability.
### Vite SPA + Hono/Fastify API on Google Cloud Run
Most portable, and commercial use is allowed. Rejected for now: it needs a separate marketing build or prerendering, a billing account with a card (risk of real charges), cold starts, and CI/CD plus previews built by hand.
### Cloudflare Workers
Free and commercial use allowed. Rejected: not a full Node runtime, which conflicts with the Node preference.
## Consequences
- £0 hosting while the product is free and invite-only.
- Any commercial step (pricing page, payments, ads) requires moving to Vercel Pro (~$20 per developer seat per month) or self-hosting the Node build. That move is a hosting change, not a rewrite, because of the guardrails.
- Hobby keeps runtime logs for only 1 hour; error tracking is a future decision.
- A single function region (London) on Hobby.
- The CI Node build adds a little build time but keeps the exit route proven.
