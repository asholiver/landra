# Work Specification
## Status
Approved (by Ashley Oliver, 2026-10-05) <!-- Draft | Approved (by <human>, <date>) | Delivered | Accepted | Archived -->
## Work ID
WORK-001 (roadmap F0 Foundation)
## Objective
A deployable, secure foundation that every later feature builds on:
- a React Router v7 app on Vercel Hobby (London) backed by Neon Postgres (London);
- Google sign-in restricted to an allowlist;
- a simple placeholder public page and an authenticated empty app shell;
- CI that enforces quality gates, deploys previews and production, and proves the app also builds and runs as a standard Node server.

The production URL is publicly reachable for demos but not indexable.
## Scope
Included:
- Project scaffold: pnpm, Node LTS, TypeScript strict, React Router v7 framework mode, Biome, Vitest, Playwright, react-hook-form + zod installed and wired (used by the sign-in page only if needed; otherwise ready for F1).
- Source layout per `.agents/project/architecture.md`: `app/` (routes and UI), `src/server/` (framework-agnostic modules: config, db, auth, allowlist, logging), `src/shared/` (zod schemas and types), `drizzle/` (SQL migrations).
- Postgres via Drizzle: Better Auth tables plus an `allowed_email` table; committed SQL migrations; migration runner.
- Better Auth: Google OAuth only, allowlist hook, sessions, sign-out, OAuth Proxy for preview deployments.
- Routes: `/` placeholder public page, `/sign-in`, `/app` authenticated shell, `/healthz`, a 404 page and an error boundary.
- Site-wide noindex, security headers.
- Owner script to add or remove allowlisted emails.
- Local development: Docker Compose Postgres, `.env.example`, README setup section.
- CI/CD on GitHub Actions: gates, Node-build smoke test, Neon preview branches, preview deploys, production deploy from `main`.
- `.agents/gates.json` updated with the real `fast` and `full` commands.

Excluded (later features):
- Any opportunity or domain data (F1). Backups (F1).
- Polished public site, request access, privacy notice (F15).
- Email sign-in, invites UI, export/delete (F5).
- Error-tracking service (pending decision before F5). Analytics.
- A product name or brand. The UI uses a neutral placeholder from config.
## Requirements
- R1 `pnpm dev` runs the app locally against Docker Postgres. Documented setup takes a new developer from clone to running app.
- R2 Public routes `/` and `/sign-in` are pre-rendered at build time and ship minimal client JS.
- R3 `/app/*` routes require a valid session. Without one, they redirect to `/sign-in` (with a safe, same-origin return path).
- R4 Signing in with a Google account whose verified email is on the allowlist creates or loads the user and lands on `/app`.
- R5 Signing in with a Google account not on the allowlist creates no user, session or account rows, and shows a neutral "access not available" message.
- R6 Sign-out invalidates the server session and clears the cookie.
- R7 `/healthz` returns 200 with build version and no database call (liveness). It's cheap and doesn't wake Neon.
- R8 The product name renders from a single config constant, currently the working label "Job Search Copilot" (not an approved name). The working name "landra" doesn't appear in UI copy.
- R9 Every HTTP response carries `X-Robots-Tag: noindex, nofollow`; pages include `<meta name="robots" content="noindex, nofollow">`; `robots.txt` allows crawling (so the noindex can be seen).
- R10 Security headers on all responses: CSP (no `unsafe-inline` scripts; nonce-based if needed), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'` (via CSP), and a restrictive `Permissions-Policy`.
- R11 Structured JSON server logs to stdout (request id, route, status, duration). Never logs tokens, cookies, secrets or full email addresses.
- R12 Configuration is validated at startup with zod. Missing or invalid env vars fail fast with a clear message that names the variable but not its value.
- R13 Allowlist script: `pnpm allowlist add|remove|list <email>` against the database in `DATABASE_URL`. Emails are normalised (trimmed, lower-cased).
- R14 CI on every PR from this repository: `full` gate, Node-build smoke test, Neon branch created, migrations applied to it, preview deployed with that branch's `DATABASE_URL`, and the preview URL reported on the PR. The Neon branch is deleted when the PR closes.
- R15 CI on `main`:
  1. The `full` gate runs.
  2. A production job bound to the GitHub `production` environment waits for the owner's explicit manual approval. Without that approval nothing touches production.
  3. After approval: production migrations are applied, the production deployment runs, and a post-deploy `/healthz` check runs.
- R16 Vercel's own Git auto-deploys are disabled. Deployments happen only through CI (`vercel build` + `vercel deploy --prebuilt`), so gates always run first.
- R17 Vercel functions are pinned to `lhr1` in `vercel.json`. The Neon project is in `aws-eu-west-2`.
- R18 The Node build: building without the Vercel preset produces a server that `react-router-serve` (or the official Node adapter) can start. CI starts it and asserts `/` and `/healthz` return 200.
## Business rules
- BR1 Only allowlisted emails may have accounts (ADR-0002). The allowlist is checked server-side in Better Auth's user-creation hook, not in the UI.
- BR2 Only Google accounts with a verified email are accepted.
- BR3 The allowlist is never seeded from repository content. The owner adds their own email with the script after the first deploy.
## Architecture
- ADR-0001 framework and hosting, with portability guardrails.
- ADR-0002 authentication.
- ADR-0003 database and data access.
- ADR-0004 public site and app structure; noindex.
- Route loaders and actions call `src/server/*`. Nothing under `src/server/` imports from `react-router` or `@vercel/*`. An import-boundary check enforces this: a Biome rule if available, otherwise a small test.
- Vercel-specific code is limited to `react-router.config.ts` (preset, applied only when building for Vercel) and `vercel.json`.
## Data
Migration `0000_init` (generated by drizzle-kit, reviewed as SQL):
- Better Auth core tables (`user`, `session`, `account`, `verification`) as generated for the Drizzle adapter.
- `allowed_email`:
  - `email` text primary key (normalised lower-case);
  - `created_at` timestamptz not null default now();
  - `note` text null.

Conventions for later features (documented, not yet exercised):
- Every user-owned table has `user_id` referencing `user(id)` with `on delete cascade`.
- Timestamps are timestamptz.
- IDs are text/UUID as Better Auth uses.
## API
- Better Auth handler mounted at `/api/auth/*` (resource route).
- `GET /healthz` → `200 {"status":"ok","version":"<git sha>"}`.
- No other endpoints in F0.
## UI
- `/`: simple placeholder public page with the working label "Job Search Copilot" (from config), a one-line description, and a "Sign in" link. Semantic, accessible, responsive. No visual design investment (F15 owns polish).
- `/sign-in`: "Continue with Google" button (native `<button>`), an error state for refused or failed sign-in, and a loading state.
- `/app`: authenticated shell with a header (placeholder name, user's name/avatar, sign-out button) and an empty-state main area ("Your pipeline will appear here").
- 404 and generic error pages that don't leak stack traces in production.
- All pages: semantic landmarks, visible focus, keyboard operable, labelled controls.
## Security
Threats and controls:
- **Unauthorised account creation:** server-side allowlist hook (BR1); negative tests (R5).
- **Session theft or fixation:** Better Auth sessions; cookies `HttpOnly`, `Secure` (in production), `SameSite=Lax`; session rotation on sign-in; sign-out invalidates server-side.
- **CSRF:** Better Auth origin checks with `trustedOrigins` restricted to production, previews (via the proxy) and localhost. Any future state-changing route uses POST with origin checking.
- **Open redirect:** the return path after sign-in must be a same-origin relative path; tested.
- **OAuth Proxy abuse:** the proxy secret lives only in Vercel and GitHub environment secrets. The workflow uses `pull_request` (not `pull_request_target`), so fork PRs get no secrets and no preview.
- **Secrets:** only in Vercel/GitHub environment secrets; `.env*` gitignored except `.env.example`; secret scanning in CI (gitleaks or GitHub secret scanning plus push protection).
- **Supply chain:** pinned versions and a committed lockfile; `pnpm audit --prod` in the `full` gate (fails on high or critical); Dependabot security updates; no install scripts from unvetted packages (pnpm's default of blocking dependency build scripts, with an explicit allow-list).
- **Data exposure:** the `X-Robots-Tag` header and security headers (R9, R10); no stack traces or internal errors to clients; logs redacted (R11).
- **Least privilege:** the Neon production role used by the app has no superuser rights; the migration role is separate if Neon Free allows it (otherwise recorded as an accepted risk). The Vercel token in GitHub is scoped to this project/team.
- **Public repository:** no personal data, allowlisted emails or environment values committed.
## Scalability and reliability
- Load assumption: one user, fewer than 1k requests a day. Well within Hobby and Neon Free.
- Neon cold start after 5 minutes idle: the first request may take ~1s or more; acceptable. The DB driver is chosen for serverless use (Neon serverless driver or `pg` with a pooled connection string), decided in implementation and recorded.
- Connection handling: use Neon's pooled connection string for the app; a direct connection for migrations.
- Failure behaviour:
  - Database unavailable: app routes show the error page with status 503, and the health check still answers.
  - Google unavailable: the sign-in error state shows.
- Limit breach on Hobby pauses the feature; acceptable at this stage, and alerting is out of scope.
- Migrations run before deploy and must be backward-compatible (ADR-0003).
## Observability
- Structured JSON logs (R11), including a per-request id returned in an `X-Request-Id` header.
- Vercel runtime logs keep 1 hour on Hobby (accepted; error tracking decided before F5).
- `/healthz` checked by CI after every production deploy.
## Testing
- Unit (Vitest):
  - config validation;
  - email normalisation;
  - allowlist hook allow/deny;
  - return-path sanitisation;
  - the import-boundary rule.
- Integration (Vitest + real Postgres):
  - migrations apply cleanly to an empty database;
  - allowlist script add/remove/list;
  - Better Auth user-creation hook refuses a non-allowlisted email and leaves no rows behind;
  - session invalidation on sign-out.
- E2E (Playwright, against a local production build with CI Postgres):
  - `/` and `/sign-in` render;
  - `/app` redirects to `/sign-in` when signed out;
  - with a test session seeded directly in the database by a test-only fixture (not an app route), `/app` renders the shell, and sign-out returns to `/` and `/app` redirects again;
  - noindex header and meta present;
  - security headers present.
  - Real Google OAuth isn't automated; it's verified manually on the first production deploy (see acceptance).
- Accessibility: axe checks inside the Playwright tests for `/`, `/sign-in`, `/app`. Zero serious or critical violations.
- Performance: Lighthouse CI on `/` and `/sign-in` (local production build) with Performance, Accessibility, Best Practices ≥98. SEO is excluded only because of the deliberate noindex; it's re-enabled in F15.
- Node build smoke test (R18).
- Security: `pnpm audit --prod`, secret scan.
## Risks
- Better Auth + React Router v7 + Drizzle version compatibility. Mitigation: pin versions and integration-test the auth flow.
- OAuth Proxy plugin behaviour on Vercel preview URLs. Mitigation: verify on the first preview. Fallback: previews have no sign-in and are used only for the public pages.
- Vercel Deployment Protection may block access to previews or production. Mitigation: configure explicitly: production public; previews protected by Vercel Authentication (Hobby feature) or public, decided by the owner during setup.
- Neon Free permissions may not allow a separate least-privilege app role. Mitigation: record as an accepted risk if so.
- The production approval step adds a click per deploy (see Open decisions).
## Acceptance criteria
- AC1 Fresh clone → follow README → `pnpm dev` serves `/` locally against Docker Postgres.
- AC2 The `fast` gate (Biome check, typecheck, unit tests) passes locally in under ~60s, and `.agents/gates.json` contains the real commands.
- AC3 The `full` gate (fast + integration + build for Vercel + Node build smoke + E2E + axe + Lighthouse CI + `pnpm audit --prod`) passes in CI.
- AC4 Opening a PR creates a Neon branch, applies migrations, deploys a preview, and posts its URL. Closing the PR deletes the branch.
- AC5 Merging to `main` alone changes nothing in production. After the owner approves the `production` environment job, CI applies migrations and deploys production. The post-deploy `/healthz` check returns 200 with the merged commit SHA.
- AC6 Production `/` loads over HTTPS at the `*.vercel.app` URL, with `X-Robots-Tag: noindex, nofollow` and the security headers from R10.
- AC7 Manual check on production:
  - an allowlisted Google account signs in and reaches `/app` showing the user's name;
  - a non-allowlisted Google account is refused with the neutral message, and no `user` row is created (verified by query);
  - sign-out returns to `/`, and `/app` then redirects to `/sign-in`.
- AC8 Signed-out requests to `/app` and `/app/anything` redirect to `/sign-in`; a crafted `returnTo=https://evil.example` is ignored (automated test).
- AC9 Vercel function region is `lhr1` and the Neon project region is `aws-eu-west-2` (verified in the deployment summary and Neon console).
- AC10 The CI Node build starts with the standard React Router Node server, and `/` and `/healthz` return 200.
- AC11 No file under `src/server/` imports `react-router` or `@vercel/*` (automated check).
- AC12 Lighthouse (local production build) on `/` and `/sign-in`: Performance, Accessibility, Best Practices ≥98. axe reports no serious or critical issues on `/`, `/sign-in`, `/app`.
- AC13 The repository contains no secrets, `.env` files or allowlisted emails. The secret scan passes.
- AC14 The UI contains no occurrence of "landra". "Job Search Copilot" appears in exactly one source location (the product config module), enforced by a test.
## Definition of done
- Implementation complete
- Meaningful tests pass
- Lint/format/typecheck pass where applicable
- Security checks pass where applicable
- Build succeeds
- Lighthouse >=98 where applicable
- Required load/concurrency checks pass (none required at F0 scale; stated deliberately)
- Independent review passes
- Human acceptance complete where required (AC7, AC9 are manual owner checks)
## Open decisions
Resolved at approval (Ashley Oliver, 2026-10-05):
- DECIDED A1 Production deploys require explicit manual approval in the GitHub `production` environment (required reviewer: owner). A merge to `main` alone never authorises a production deploy.
- DECIDED A2 Docker Compose Postgres for local development (Docker is installed).
- DECIDED A3 Node 24 LTS if Vercel and all selected dependencies support it when implementation starts; otherwise Node 22 LTS.
  - The chosen major is pinned identically in `.nvmrc`, `package.json` `engines` (with `engine-strict`), CI `setup-node` (read from `.nvmrc`) and the Vercel project Node version.
  - The CI Node-build smoke test uses the same version.
  - The choice and its evidence are recorded under Implementation state.
- DECIDED A4 The production URL is publicly reachable (no Vercel Deployment Protection on production). Preview protection is chosen by the owner at Stage 2.
- DECIDED A5 Temporary display name "Job Search Copilot": a working label, not an approved product name. Defined once in the product config module (ADR-0004); a test enforces that no other source file contains it.
- OPEN O1 Neon driver choice (serverless driver vs `pg` + pooler). Decided during implementation and recorded under Implementation state; doesn't change behaviour.

## Delivery stages and human boundaries
Implementation happens locally first. External services are needed only at the stage that genuinely requires them. At each boundary, delivery stops and gives the owner exact setup instructions. Agents never create, guess or commit credentials, never weaken a control to avoid a missing dependency, and never push to `main`, merge PRs, ship to production or perform other high-impact operations without the owner's explicit approval.

- **Stage 0: local, no external accounts.** Everything in Scope except actually running CI and hosting:
  - scaffold, gates, Docker Postgres, migrations, Better Auth with the allowlist hook, routes, headers, logging, allowlist script;
  - unit, integration and E2E tests (E2E uses a seeded test session);
  - axe, Lighthouse CI, the Node-build smoke test;
  - CI workflow files written and validated locally (e.g. actionlint) but not yet run.
  - Google credentials are optional outside production. When absent, the Google provider is not registered and the sign-in page says Google sign-in is not configured in this environment. There is no alternative sign-in method and no bypass. Production config validation requires the credentials (fail fast).
  - Covers AC1–AC3, AC8 and AC10–AC14 locally.
- **Gate checkpoint (inside Stage 0).** Gate commands are read from the committed `.agents/gates.json`, and an agent must not define the checks for its own work. So:
  - The first task installs the toolchain and proposes the real `fast`/`full` commands.
  - Delivery then stops for the owner to review those commands.
  - They are committed only after the owner approves.
  - Until then, gate verdicts are reported as they are (the committed placeholders fail), never as passed.
- **Stage 1: push and CI (owner approval required).** Pushing the work branch publishes code to the public repository, so it needs the owner's go-ahead. CI runs the `full` gate on the PR with no secrets. Hosting jobs report `SKIPPED: not configured` (never "passed") while Stage 2 secrets are absent.
- **Stage 2: preview environments.** The owner creates:
  - a Vercel project (Git auto-build disabled, Node version per A3, function region `lhr1`) and a project-scoped token;
  - a Neon project in `aws-eu-west-2` and an API key;
  - a Google OAuth client;
  - an OAuth proxy secret.

  Secrets go into GitHub only. Delivery gives exact step-by-step instructions at this point. Covers AC4.
- **Stage 3: production.** The owner:
  - creates the GitHub `production` environment with themselves as required reviewer;
  - adds the production secrets;
  - registers the production redirect URI with Google;
  - approves the first production job;
  - runs the allowlist script for their own email;
  - then performs the manual checks AC5–AC7 and AC9.

Secrets needed by Stage 3: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `NEON_API_KEY`, `NEON_PROJECT_ID`, `DATABASE_URL` (prod, pooled), `DATABASE_URL_UNPOOLED` (prod, migrations), `BETTER_AUTH_SECRET`, `OAUTH_PROXY_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
## Implementation state
<!-- maintained by /ai-engineering:deliver: tasks, owners, status, gate results -->
Tasks run one at a time in this checkout on `work/WORK-001-f0-foundation` (no `worktree.baseRef`). Stage 0 only.

| Task | Owner | Depends on | Scope | Covers | Status |
|---|---|---|---|---|---|
| T1 Toolchain scaffold and proposed gates | ai-engineering:platform | — | `package.json`, lockfile, `.nvmrc`, `.npmrc`, `tsconfig*.json`, `biome.json`, `vite.config.ts`, `react-router.config.ts` (preset only when building for Vercel), `vitest.config.ts`, `playwright.config.ts`, `docker-compose.yml`, `.env.example`, `.gitignore`, a minimal `app/` (root and a route) so the build works, README setup section; **proposes** `fast`/`full` in `.agents/gates.json` (working tree only) | A2, A3, R1, AC1, part of AC2 | done (uncommitted) |
| ⛔ Gate checkpoint | Owner | T1 | Owner reviews the proposed gate commands; they're committed only after approval | — | done (approved by Ashley Oliver, 2026-10-05) |
| T2 Server foundation: config, database, auth, allowlist | ai-engineering:backend | checkpoint | `src/server/**`, `src/shared/**`, `drizzle/**`, `drizzle.config.ts`, `scripts/allowlist.ts`, auth resource route `app/routes/api.auth.$.ts`, `app/routes/healthz.ts`, session-guard helper, unit and integration tests | R3–R7, R11–R13, BR1–BR3, AC8, AC11, part of AC13 | pending |
| T3 Public and app UI, headers, noindex, accessibility and performance | ai-engineering:frontend | T2 | `app/**` (except T2's routes), `app/entry.server.tsx` (security headers, nonce CSP, X-Robots-Tag, X-Request-Id), `src/shared/product.ts` (working label), `public/robots.txt`, E2E + axe tests, Lighthouse CI config | R2, R8–R10, AC6 (locally), AC12, AC14 | pending |
| T4 CI workflows and Node-build smoke | ai-engineering:platform | T3 | `.github/workflows/**`, `.github/dependabot.yml`, `vercel.json`, Node-build smoke script, secret-scan config | R14–R18 (workflow files only), AC10, AC13; jobs needing secrets report SKIPPED until Stage 2 | pending |
| Prove | coordinator + qa + security-reviewer | T4 | full gate, QA against the spec, security review (auth, secrets, headers, CI) | — | pending |

T1 results (2026-10-05):
- **A3 Node version: 24.**
  - Vercel lists 24.x as a supported (and default) Node version, and `engines.node` overrides the project setting.
  - React Router 7.18.4, Vite 8.3.2, Vitest 5.0.3 and Playwright 1.63.0 all allow Node 24.
  - better-auth 1.7.7 and drizzle 0.45.3 / drizzle-kit 0.31.11 declare no engines field; T2 confirms them in practice.
  - Pinned in: `.nvmrc` (24), `engines.node` (24.x), `packageManager` (pnpm 10.34.6), `.npmrc` (`engine-strict=true`).
- **Version notes:**
  - React Router is pinned to 7.18.4, the latest 7.x; npm `latest` is 8.x and ADR-0001 specifies v7.
  - TypeScript is pinned to 5.9.3, because @react-router/dev 7 requires TypeScript ^5 or ^6.
- **@vercel/react-router** is a devDependency. As a runtime dependency it pulls in a high-severity `braces` advisory with no fix; it's only used at build time.
- **No dependency build scripts are allowed;** esbuild's is ignored.
- **Coordinator verification on Node 24.21.0:**
  - `run-gate.sh fast` → `GATE fast: FAILED (exit 1)`, as expected, because the committed placeholder is used until the checkpoint.
  - Working-tree `pnpm run check:full` → exit 0: lint, typecheck, 1 unit test, both builds, 1 E2E test, and the audit reported no known vulnerabilities.

Gate checkpoint decisions (Ashley Oliver, 2026-10-05):
- **Gate commands** are listed explicitly in `.agents/gates.json`:
  - `fast` = lint, typecheck, unit tests;
  - `full` = fast + integration tests + Node build + Vercel build + E2E + `pnpm audit --prod --audit-level high`.
  - The `check:fast`/`check:full` package scripts were removed, so `gates.json` is the only gate definition.
  - Every later addition to a gate (axe, Lighthouse, Node-build startup check, secret scan) is an explicit `gates.json` change that review flags and the owner approves. It's never hidden behind a package script.
  - Known residual gap: individual commands still resolve through `package.json`. Recorded as a candidate improvement for the AI Engineering System, not redesigned here.
- **Node:** the owner's machine-wide nvm default stays unchanged. Coordinator and agents activate the repository's pinned Node (`nvm use`, reading `.nvmrc`) within their own shell before running pnpm or gates. No global environment changes.
- **Local Postgres prerequisite:** integration tests must fail fast with a clear, actionable message (e.g. "PostgreSQL is not reachable at <host:port>; run `docker compose up -d`") when the database is unavailable, instead of an obscure test failure. Keep it a lightweight pre-check, not new orchestration (assigned to T2).
## Review state
<!-- maintained by /ai-engineering:review: gates, security, QA, EXTERNAL REVIEW status -->
-
