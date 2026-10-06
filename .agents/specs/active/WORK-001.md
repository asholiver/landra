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
- R7 `/healthz` returns 200 with the build version and no database call (liveness). It's cheap and doesn't wake Neon. The version comes from `GIT_SHA`, then `VERCEL_GIT_COMMIT_SHA`, then `"dev"`.
- R8 The product name renders from a single config constant, currently the working label "Job Search Copilot" (not an approved name). The working name "landra" doesn't appear in UI copy.
- R9 Every HTTP response carries `X-Robots-Tag: noindex, nofollow`; pages include `<meta name="robots" content="noindex, nofollow">`; `robots.txt` allows crawling (so the noindex can be seen).
- R10 Security headers on all responses: CSP (no `unsafe-inline` scripts; nonce-based if needed), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'` (via CSP), and a restrictive `Permissions-Policy`.
- R11 Structured JSON server logs to stdout (request id, route, status, duration). Never logs tokens, cookies, secrets or full email addresses.
- R12 Configuration is validated at startup with zod. Missing or invalid env vars fail fast with a clear message that names the variable but not its value.
- R13 Allowlist script: `pnpm allowlist add|remove|list <email>` against the database in `DATABASE_URL`. Emails are normalised (trimmed, lower-cased).
  - `remove` also revokes all of that user's sessions in the same READ COMMITTED transaction (owner decision M-1), and reports how many sessions it revoked.
  - A database trigger refuses new sessions for emails that aren't allowlisted.
- R14 CI on every PR from this repository:
  1. The `full` gate and the Node-build smoke test run.
  2. A branch is created in the **separate preview Neon project** (never production; ADR-0003 as amended), and migrations are applied to it.
  3. A preview is deployed with only that branch's URLs and preview-only secrets.
  4. The preview URL is reported on the PR.
  5. The branch is deleted when the PR closes.

  PR workflows never have access to production secrets: those live only in the GitHub `production` environment.
- R15 CI on `main`:
  1. The `full` gate runs.
  2. A production job bound to the GitHub `production` environment waits for the owner's explicit manual approval. Without that approval nothing touches production.
  3. After approval: production migrations are applied, the production deployment runs, and a post-deploy `/healthz` check runs.
- R16 Vercel's own Git auto-deploys are disabled. Deployments happen only through CI (`vercel build` + `vercel deploy --prebuilt`), so gates always run first.
- R17 Vercel functions are pinned to `lhr1` in `vercel.json`. The Neon project is in `aws-eu-west-2`.
- R18 The Node build: building without the Vercel preset produces a server started with `pnpm start`. That is the custom Express server `server/node-server.ts`, using the official `@react-router/express` adapter and run via Node 24 type stripping; `@react-router/serve` was removed. `pnpm smoke:node` (part of the `full` gate) starts it and asserts that `/` and `/healthz` return 200 with the shared security headers.
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
- E2E (Playwright, against the production Node server build, with sessions seeded in a per-run database on the disposable `postgres-test` server):
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
- AC10 The Node build starts with `pnpm start` (custom Express server with `@react-router/express`), and `/` and `/healthz` return 200. Verified by `pnpm smoke:node` in the `full` gate, which CI runs.
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
  - a separate **preview** Neon project in `aws-eu-west-2` (Postgres 14 or later; migrations use `CREATE OR REPLACE TRIGGER`), with no production data, and a Neon API key restricted to that project if project-scoped keys are available on the plan (otherwise delivery stops for an owner decision);
  - a preview-only `BETTER_AUTH_SECRET`, distinct from production's;
  - a Google OAuth client;
  - an OAuth proxy secret (distinct from both auth secrets).

  **Stage 2 verification items** (these can't be verified locally, and none is considered verified until checked on a real preview):
  - **T3-L1:** security headers, including CSP, HSTS and `X-Robots-Tag`, on `/`, `/index.html`, `/sign-in`, `/sign-in/`, `/sign-in/index.html`, an asset, `/healthz` and `/app`. Also check that no headers are duplicated.
  - **T3-L2:** the proxied Google sign-in on a preview completes, and isn't blocked by CSP `form-action`.
  - The OAuth Proxy plugin works on preview URLs (spec Risks).
  - **T3-M1 on Vercel** (unverified locally). Source-verified facts (better-auth 1.7.7 `getIP`): without `trustedProxies`, `x-forwarded-for` is used only when it holds exactly one IP. A multi-value header resolves to no IP, and all clients then share one per-path bucket of 3 requests per 10 seconds, which could lock every user out of sign-in. On a real preview, verify:
    - the `x-forwarded-for` header the function receives is a single, Vercel-overwritten client IP (log the header's value count, never the IP itself);
    - the 4th rapid `POST /sign-in/google` from one client returns 429;
    - a second client is unaffected;
    - varying the client-supplied `X-Forwarded-For` doesn't bypass the limit.

    If the header holds multiple values, configure `advanced.ipAddress` (e.g. Vercel's documented client-IP header, or `trustedProxies`) before production. In-memory limits are per instance (L-2, F5).
  - `/sign-in` resolves without a redirect on Vercel.

  Preview secrets go into GitHub repository/PR-accessible secrets. Production secrets go only into the `production` environment (Stage 3). Delivery gives exact step-by-step instructions at this point. Covers AC4.
- **Stage 3: production.** The owner:
  - creates the GitHub `production` environment with themselves as required reviewer **and deployment branches restricted to `main`** (owner decision C/F2);
  - adds the production environment secrets and the `PRODUCTION_URL` environment variable;
  - sets the repository variable `PRODUCTION_DEPLOY_ENABLED=true`, last;
  - registers the production redirect URI with Google;
  - approves the first production job;
  - runs the allowlist script for their own email;
  - then performs the manual checks AC5–AC7 and AC9.

Stage 3 configuration. Production gets no Neon management credentials (owner decision T4-5).
- **`production` environment secrets:** `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (migrations), `BETTER_AUTH_SECRET`, `OAUTH_PROXY_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- **Environment variable:** `PRODUCTION_URL` (https origin, no trailing slash).
- **Repository variable:** `PRODUCTION_DEPLOY_ENABLED=true`, set last.

Stage 2 configuration, repository level. Preview Vercel resources live in a **separate Vercel team or account with no production project** (owner decision B/F1, ADR-0003 amended).
- **Secrets:** `PREVIEW_VERCEL_TOKEN`, `PREVIEW_VERCEL_ORG_ID`, `PREVIEW_VERCEL_PROJECT_ID`, `PREVIEW_NEON_API_KEY`, `PREVIEW_NEON_PROJECT_ID`, `PREVIEW_BETTER_AUTH_SECRET`, `PREVIEW_OAUTH_PROXY_SECRET`, `PREVIEW_GOOGLE_CLIENT_ID`.
- **Variables:** `PREVIEW_OAUTH_PROXY_PRODUCTION_URL`, `PREVIEW_ALIAS_PREFIX`.
- **No `PREVIEW_GOOGLE_CLIENT_SECRET`** (F3 outcome, below). `PREVIEW_GOOGLE_CLIENT_ID` is the same public client ID as production. The Google client's redirect URIs list production only.
## Implementation state
<!-- maintained by /ai-engineering:deliver: tasks, owners, status, gate results -->
Tasks run one at a time in this checkout on `work/WORK-001-f0-foundation` (no `worktree.baseRef`). Stage 0 only.

| Task | Owner | Depends on | Scope | Covers | Status |
|---|---|---|---|---|---|
| T1 Toolchain scaffold and proposed gates | ai-engineering:platform | — | `package.json`, lockfile, `.nvmrc`, `.npmrc`, `tsconfig*.json`, `biome.json`, `vite.config.ts`, `react-router.config.ts` (preset only when building for Vercel), `vitest.config.ts`, `playwright.config.ts`, `docker-compose.yml`, `.env.example`, `.gitignore`, a minimal `app/` (root and a route) so the build works, README setup section; **proposes** `fast`/`full` in `.agents/gates.json` (working tree only) | A2, A3, R1, AC1, part of AC2 | done (uncommitted) |
| ⛔ Gate checkpoint | Owner | T1 | Owner reviews the proposed gate commands; they're committed only after approval | — | done (approved by Ashley Oliver, 2026-10-05) |
| T2 Server foundation: config, database, auth, allowlist | ai-engineering:backend | checkpoint | `src/server/**`, `src/shared/**`, `drizzle/**`, `drizzle.config.ts`, `scripts/allowlist.ts`, auth resource route `app/routes/api.auth.$.ts`, `app/routes/healthz.ts`, session-guard helper, unit and integration tests | R3–R7, R11–R13, BR1–BR3, AC8, AC11, part of AC13 | done: targeted security review plus re-review; all BLOCKER/HIGH fixed; M-1, M-2, M-3, M-A and L-A to L-E fixed; L-2 deferred to F5 |
| T3 Public and app UI, headers, noindex, accessibility and performance | ai-engineering:frontend | T2 | `app/**` (except T2's routes), `app/entry.server.tsx` (security headers, nonce CSP, X-Robots-Tag, X-Request-Id), `src/shared/product.ts` (working label), `public/robots.txt`, E2E + axe tests, Lighthouse CI config | R2, R8–R10, AC6 (locally), AC12, AC14 | done. Targeted security review: no BLOCKER/HIGH; 1 MEDIUM and 5 LOW reported to the owner |
| T4 CI workflows and Node-build smoke | ai-engineering:platform | T3 | `.github/workflows/**`, `.github/dependabot.yml`, `vercel.json`, Node-build smoke script, secret-scan config | R14–R18 (workflow files only), AC10, AC13; jobs needing secrets report SKIPPED until Stage 2 | done locally (workflows not yet run on GitHub). zizmor default persona: no findings, but it ran offline, so the network audits weren't run and are covered by the Prove security review. T3 was accepted complete by the owner on 2026-10-05; the final review cycle must include `d5676b9` and `4f3111b` |
| Prove | coordinator + qa + security-reviewer | T4 | full gate, QA against the spec, security review (auth, secrets, headers, CI) | — | done 2026-10-06 (committed full gate PASSED at 4fc5d37; QA PASS with 1 MEDIUM gap; security: no BLOCKER, ready for Stage 1; 1 HIGH blocks Stage 2). Remediation proposal awaiting owner approval |

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
- **Integration-test database isolation** (approved by Ashley Oliver, 2026-10-05, subject to security review of the implementation). This approves only this narrowly defined mechanism; it is not blanket approval for SQL DROP.
  - Requirements:
    - A disposable test server (`postgres-test` Compose service), separate from the dev database. It listens only on `127.0.0.1:5434`, stores data in tmpfs, and is started with `-c app.disposable_test_server=on`.
    - Tests require an explicit `TEST_DATABASE_URL`. They never fall back to a default or to `DATABASE_URL`/`DATABASE_URL_UNPOOLED`.
    - Before any DDL, all of these must hold, or the run aborts having issued no SQL other than reading the marker:
      - the host is loopback (`127.0.0.1`, `localhost`, `::1`) and the port is exactly 5434;
      - the URL is not equal to the application URLs (normalised);
      - the host is not a Neon host;
      - `NODE_ENV` is not `production`;
      - `VERCEL` is unset;
      - `SHOW app.disposable_test_server` returns `on`.
    - Each run creates its own database `it_<12 random [a-z0-9]>`, validated against `^it_[a-z0-9]{12}$`.
    - Cleanup drops only that run's internally generated name, held in memory. The name is never taken from env, arguments or files. All safeguards are re-checked immediately before cleanup.
    - Failure to clean up is safe, because the server is disposable.
    - Every refusal path has a negative automated test.
    - The destructive code gets explicit security review.
  - The previous design (default URL on the dev server at 5433, name-suffix check only, `DROP … WITH (FORCE)`) was denied and is replaced.
- T2 results (2026-10-05, Node 24.21.0):
  - Unit: 10 files, 106 tests. Integration: 3 files, 11 tests, against the disposable server.
  - Both builds pass.
  - Coordinator `run-gate.sh fast` → `GATE fast: PASSED (exit 0)`.
  - Demonstrated:
    - the run database is removed after the run;
    - pointing at dev port 5433 aborts before any SQL;
    - unset `TEST_DATABASE_URL` aborts;
    - a stopped `postgres-test` gives the actionable message.
  - **O1 decided:** `pg` (node-postgres) via drizzle `node-postgres` against Neon's pooled URL, with the same code path locally.
    - Bounded pool (max 5, 15s connect, 15s statement timeout) and an idle-error handler.
    - Migrations use the unpooled URL.
  - Owner decisions on T2 (Ashley Oliver, 2026-10-05):
    - **Keep the session-creation allowlist hook.** A de-listed user can't start a new session. What happens to already-active sessions must be documented exactly, with no claim of full revocation unless that is implemented and tested.
    - **Accept the optional `OAUTH_PROXY_PRODUCTION_URL`** as configuration only, with no Vercel-specific assumptions in application/domain logic.
    - **Approved gate change:** `full` sets `TEST_DATABASE_URL=postgresql://app:app@127.0.0.1:5434/postgres` explicitly.
      - Throwaway, non-secret credentials for the disposable local/CI test server only.
      - No dependence on ambient `DATABASE_URL`, `.env` or shell configuration.
    - **A targeted security review of T2 runs before T2 is committed.** BLOCKER/HIGH findings are fixed and retested before the commit; MEDIUM/LOW findings are reported to the owner. This doesn't replace the final WORK-001 review cycle.
- **Targeted T2 security review** (2026-10-05, ai-engineering:security-reviewer): 0 BLOCKER, 4 HIGH, 3 MEDIUM, 4 LOW. Verdict: not ready to commit until the HIGH findings are fixed.
  - HIGH:
    - HIGH-1: query parameters in `TEST_DATABASE_URL` (`host=`, `port=`) override the checked host and port in `pg`.
    - HIGH-2: the disposable-server marker can be spoofed through the `options=` connection parameter or an ambient `PGOPTIONS`.
    - HIGH-3: `sanitiseReturnPath` returns `//evil.example` for dot-segment inputs (an open redirect, AC8).
    - HIGH-4: the OAuth Proxy completion endpoints on production let anyone holding the proxy secret mint a session for any allowlisted email.
    - Status: all four sent back to T2 for fixes with regression tests.
  - MEDIUM:
    - M-1: active sessions survive removal from the allowlist (sliding 7-day refresh updates the row; the hook doesn't fire). Being documented and tested as current behaviour; revocation is an owner decision.
    - M-2: Better Auth's internal logs bypass the redacting logger, and drizzle errors include query parameters.
    - M-3: cookie security, localhost trusted origins and rate limiting depend only on `NODE_ENV`.
    - M-2 and M-3 are awaiting owner decisions.
  - LOW:
    - L-1: the TCP pre-check runs before the safety checks, and the `[::1]` probe fails. Being fixed now, because it's inside the approved test-DB mechanism.
    - L-2: in-memory rate limiting is per serverless instance.
    - L-3: `OAUTH_PROXY_SECRET` could equal `BETTER_AUTH_SECRET`.
    - L-4: a cleanup error after a migration failure is swallowed. Being fixed with L-1.
    - L-2 and L-3 are awaiting owner decisions.
- **HIGH remediation** (2026-10-05): HIGH-1 to HIGH-4 are fixed, along with L-1, L-4 and the M-1 documentation. Each has a regression test.
  - Coordinator `run-gate.sh fast` → `GATE fast: PASSED (exit 0)`.
  - The working-tree `full` command, run in an environment without `.env`, `DATABASE_URL`, `PGOPTIONS` or `TEST_DATABASE_URL`, exited 0:
    - unit: 10 files, 121 tests;
    - integration: 5 files, 16 tests;
    - both builds passed; 1 E2E test passed;
    - `pnpm audit --prod --audit-level high` passed.
  - The audit also reports 1 **moderate** advisory below the threshold: esbuild ≤0.24.2, GHSA-67mh-4wv8-2f99. It affects esbuild's dev server only, via `better-auth > drizzle-kit > @esbuild-kit/esm-loader`, and is reported to the owner.
  - Residual from the HIGH-4 fix: a leaked proxy secret still works against previews. Resolved by owner decision 6 below: previews hold no production data.
- **Owner decisions after the review** (Ashley Oliver, 2026-10-05, binding for T2):
  1. **M-1:** `pnpm allowlist remove` revokes the user's existing sessions atomically, as well as removing the email (real revocation), with tests for no new session, existing session invalidated, other users unaffected, and atomicity. The owner wrote `allowed-email`; the coordinator kept the existing `allowlist` command name (R13) unless the owner asks for a rename.
  2. **M-2:** Better Auth logging goes through the redacting logger.
  3. **M-3:** reject an https `BETTER_AUTH_URL` without `NODE_ENV=production`; require https in production. Tests for accepted and rejected combinations.
  4. **L-2:** deferred to F5. Rate limiting is in-memory per serverless instance, which is weak on Vercel. F5 owns a shared-store treatment before inviting other users. Documented in code and on the roadmap.
  5. **L-3:** the proxy secret must differ from the auth secret; minimum 32 characters; weak secrets rejected in production. Negative tests.
  6. **Preview data isolated from production:** see R14, Stage 2 and the ADR-0003 amendment.
  7. **Accepted dependency risk (temporary):**
     - Advisory: GHSA-67mh-4wv8-2f99 (moderate), esbuild ≤0.24.2.
     - Path: `better-auth > drizzle-kit > @esbuild-kit/esm-loader > @esbuild-kit/core-utils > esbuild`.
     - Why exposure is low: the advisory concerns esbuild's development server, which the production app never starts. esbuild is only reachable through drizzle-kit's loader, which isn't used at runtime.
     - The production audit gate still fails at HIGH or above; nothing is suppressed.
     - Reassess on any Better Auth, drizzle-kit or dependency upgrade, and before F5.
  8. **Round 3 (owner decisions 1–5) results:**
     - Coordinator `run-gate.sh fast` → PASSED.
     - The working-tree `full` command in a clean environment exited 0: 137 unit and 28 integration tests passed.
  9. **Focused security re-review of rounds 2–3** (2026-10-05): HIGH-1 to HIGH-4, M-1, M-2, M-3 and L-3 are verified fixed. New findings: 1 HIGH, 1 MEDIUM, 5 LOW.
     - **NEW-H1 (HIGH):** a NUL byte (`%00`) in the user or database part of `TEST_DATABASE_URL` injects a startup parameter that spoofs the disposable-server marker. Being fixed now.
     - **L-C (LOW):** the revocation transaction must be pinned to READ COMMITTED, with a deterministic race test. Being fixed now, under owner decision 1 (atomicity).
     - **L-D (LOW):** the trigger function needs a pinned `search_path`, schema-qualified tables, and coverage of `UPDATE OF user_id`. Being fixed now, under owner decision 1.
     - **M-A (MEDIUM):** the token redactor also removes request ids, git SHAs, routes and URL paths, which conflicts with R11. Owner decision.
     - **L-A (LOW):** short cookie and token values in free text, and connection-string passwords, are not redacted. Owner decision.
     - **L-B (LOW):** the proxy production guard fails open if production is served from two different origins. Owner decision.
     - **L-E (LOW):** an encoded `//` can survive dot-segment normalisation in return paths. Safe for browsers; a later decode-and-redirect would be unsafe. Owner decision.
  10. **Round 4 results:** NEW-H1, L-C and L-D fixed with regression tests.
      - Coordinator `run-gate.sh fast` → PASSED.
      - The working-tree `full` command in a clean environment exited 0: 149 unit and 32 integration tests passed.
      - Migration 0002 uses `CREATE OR REPLACE TRIGGER`, so the Neon projects must run Postgres 14 or later (added to the Stage 2 instructions).
  11. **Owner decision (Ashley Oliver, 2026-10-05):** fix M-A, L-A, L-B and L-E in T2 as recommended (round 5).
  12. The `landra_integration_tests` test-only connection identifier is acceptable.
  13. **Round 5 results:** M-A, L-A, L-B and L-E fixed with regression tests.
      - Coordinator `run-gate.sh fast` → PASSED.
      - The working-tree `full` command in a clean environment exited 0: 165 unit and 35 integration tests passed, plus both builds, E2E, and the audit at HIGH (the 1 moderate advisory is accepted).
      - Known side effect of L-A: values after keys containing token/secret/password followed by `:` or `=` are redacted (e.g. `tokens: 3`). Accepted as safe over-redaction. The working name must not appear as the user-facing product name.
  - The HIGH-4 test imports a non-public better-auth module path, so it may break on upgrade.
- **T3 results** (2026-10-05, Node 24):
  - Coordinator `run-gate.sh fast` → PASSED.
  - The proposed full command in a clean environment exited 0: 197 unit, 42 integration and 36 E2E tests passed (axe included); Lighthouse assertions passed for `/` and `/sign-in` (Performance, Accessibility and Best Practices all 1.00; SEO excluded because of noindex); audit at HIGH passed.
  - **Header/CSP design:** the pre-rendered `/` and `/sign-in` ship no inline scripts (hydration opted out; `/sign-in` uses one external `/sign-in.js`), so `script-src 'self'` works without a nonce or hash. Dynamic responses get a per-request nonce, `X-Request-Id`, the headers and a request log from root middleware. All headers are defined once, in `src/server/http/security-headers.ts`.
  - **Serving paths:**
    - Node: a custom Express server (`server/node-server.ts`, run from TypeScript source by Node 24) applies the same headers to static files.
    - Vercel: `vercel.json` headers cover exactly the statically served paths, enforced by a test. **Unverified until Stage 2.**
  - **Open items:**
    - Pre-rendered `/sign-in` can't know at build time whether Google is configured; the "not configured" message appears after the button is pressed. Without JavaScript there's no error message and no already-signed-in redirect.
    - T3 changed `app/lib/require-user.server.ts` (T2) to return 503 on database or config failure.
    - `@react-router/serve` is no longer used by `start`.
    - HSTS is set without `includeSubDomains`/`preload`.
  - **Owner decisions on T3** (Ashley Oliver, 2026-10-05):
    - **Approved gate change:** `full` adds `TEST_DATABASE_URL=postgresql://app:app@127.0.0.1:5434/postgres` to `pnpm test:e2e` and adds `pnpm lighthouse`.
    - **A targeted security review runs before the T3 commit.** BLOCKER/HIGH findings are fixed with regression tests; MEDIUM/LOW findings are reported.
    - **Accepted trade-offs:**
      - the pre-rendered `/sign-in` progressive-enhancement limits for F0;
      - conservative HSTS until an owned domain exists;
      - running Node 24 TypeScript via type stripping, provided automated startup/build checks protect its constraints (T4's Node-build smoke test must run `pnpm start`);
      - removing `@react-router/serve` in T4.
  - **Targeted T3 security review** (2026-10-05): **no BLOCKER/HIGH.** Verified:
    - headers on about 30 URL forms on the Node server;
    - nonce generation and propagation;
    - the Origin checks (missing, `null`, foreign, `.data` and GET variants);
    - no effect from a spoofed Host (`trust proxy` off);
    - DOM-safe `sign-in.js`;
    - `/app` fails closed with 503;
    - static-serving restrictions;
    - E2E disposable-DB safeguards intact.

    Findings for owner decision:
    - **T3-M1 (MEDIUM):** `POST /sign-in/google` calls `auth.api.signInSocial` directly, bypassing Better Auth's rate limiter. Each call inserts a `verification` row, and `formData()` has no body-size cap on the Node server.
    - **T3-L1:** on Vercel, `/index.html`, `/sign-in/index.html` and `/sign-in/` may be served without the headers (unverified; Stage 2 check).
    - **T3-L2:** CSP `form-action` may block the proxied sign-in redirect chain on previews (preview → Google → production → preview). Stage 2 check.
    - **T3-L3:** stack traces in `.data` responses when `NODE_ENV` isn't `production`, including an empty string.
    - **T3-L4:** the E2E health check could accept an already-running server on port 4173.
    - **T3-L5:** no `Cache-Control: private, no-store` on authenticated `/app` HTML.
    - INFO: `/sign-out` returns 500 rather than 503 on invalid config (still fails closed). **Superseded by Prove remediation A1 (2026-10-06):**
      - New E2E `database-unavailable.spec.ts` (per-run server, `DATABASE_URL` at a refused loopback port, signed session cookie):
        - `/app`, `/app/anything` and `/app.data` → 503 generic page, with no shell content or internals, plus `no-store` and noindex;
        - `/healthz` → 200 with the run's version.
      - **New finding, fixed:** with the database down, `POST /sign-out` returned 302 and cleared the cookie, while Better Auth silently failed to delete the server session. That was a **fail-open sign-out** (R6).
        - Fix: read the session first, so a database failure → 503, the cookie isn't cleared, and there's no redirect. Config and Origin checks moved inside the same try, so invalid config → 503. The fixed-text body has `no-store`. Covered by E2E.
        - Residual (code comment): a database failure in the moment between that read and the delete isn't detected.
      - `server-mode.spec.ts` now triggers its unhandled error via `GET /api/auth/get-session`.
  - **After the commit:**
    - The committed `run-gate.sh full` **FAILED** twice on the E2E test "shows the loading state while the sign-in request is in flight". **Resolved** in `d5676b9`: made deterministic, 440/440 on repeat, committed gate PASSED.
    - Root cause: a test race. The click could land before the deferred `sign-in.js` attached its submit handler.
    - Being made deterministic with a readiness marker, without weakening the assertion. It is not being rerun until green.
  - **Owner decisions** (Ashley Oliver, 2026-10-05):
    - Fix T3-M1 (through Better Auth's normal handler and rate limiter, not a home-grown limiter; plus a tested 413 body limit), T3-L3, T3-L4 and T3-L5 now, in a separate commit with the race fix.
    - **T3-L1 and T3-L2 are explicit Stage 2 verification items.** They must not be treated as verified locally:
      - T3-L1: headers on the `/index.html`, `/sign-in/index.html` and `/sign-in/` URL forms on Vercel;
      - T3-L2: the CSP `form-action` allows the proxied preview sign-in redirect chain.
  - **Gates before commit:**
    - Coordinator `run-gate.sh fast` → PASSED.
    - The working-tree approved `full` in a clean environment exited 0: 197 unit, 42 integration and 36 E2E tests, Lighthouse assertions passed, audit at HIGH passed.
  - **T3 hardening and race fix** (follow-up commit):
    - **Race fix.** The confirmed cause was `page.evaluate` hanging while the navigation was held pending; the deferred-script race was secondary. The state is now captured in-page via `exposeFunction`, with a `data-enhanced` readiness wait. The assertion is unchanged. `--repeat-each=40` → 440 passed, 0 flaky.
    - **T3-M1:**
      - `POST /sign-in/google` goes through `auth.handler`, so Better Auth's limiter applies, with a custom rule of 5 requests per 10 seconds for `/sign-in/social`.
      - The 4 KB body cap returns 413.
      - The Node server overwrites `x-forwarded-for` with the socket address and drops `x-real-ip`. Black-box testing showed spoofing bypasses the limit without this, and doesn't with it.
      - Behind a reverse proxy on self-hosted Node, all clients share one bucket (safe but strict).
      - **Correction** (owner granted read-only source inspection; the coordinator read better-auth 1.7.7 `rate-limiter/index.mjs` and core `utils/ip.mjs`):
        - Better Auth's built-in rule already limits every `/sign-in*` path to 3 requests per 10 seconds, and custom rules apply after it, so the 5-per-10-seconds custom rule had *loosened* that limit. It was removed; the built-in default applies, and the 4th rapid POST returns 429.
        - `getIP` trusts `x-forwarded-for` only when it holds a single value. A multi-value header goes to one shared bucket (now tested). A shared bucket on Vercel would mean a sign-in lockout for every user (Stage 2 check).
        - The E2E rate-limit test now uses its own server per run (free port, per-run version): a test-design fix, after repeats sharing a port collided. `--repeat-each=10` → 10/10 passed.
    - **T3-L3:** React Router runs in development mode only when `NODE_ENV=development`. Tested for unset, empty, `test` and `production`. The test wasn't proven to fail when a stack does leak.
    - **T3-L4:** a per-run version is required from `/healthz`, and setup fails clearly if the port is in use.
    - **T3-L5:** `Cache-Control: private, no-store` on all `/app` responses (HTML, `.data`, and the 404 inside the shell).
- **T4 results** (2026-10-06; committed as `220abb1` after owner decisions):
  - **What was built:**
    - removed `@react-router/serve`;
    - `pnpm smoke:node` (`pnpm start` on a free port with explicit non-secret env and a per-run version; asserts `/` and `/healthz` return 200 with the shared headers);
    - `vercel.json` with `regions: ["lhr1"]` and `git.deploymentEnabled: false` (per Vercel docs, 2026-08-25), with a test;
    - `ci.yml` (quality, secret-scan, preview-config/preview/preview-comment, production-config/production) and `preview-cleanup.yml`;
    - `dependabot.yml`;
    - `pnpm scan:secrets` (gitleaks v8.30.1, official image pinned by multi-arch digest, full history, redacted);
    - `.gitleaksignore` with 11 exact fingerprints for test fixtures already in history, each justified, no wildcards;
    - a README CI/CD section.
  - **Workflow hardening:**
    - actions pinned by SHA (actions/checkout v6.1.0, actions/setup-node v6.5.0, neondatabase create-branch v6.4.0 and delete-branch v3.2.1), read from tags with `git ls-remote` but not cross-checked with the GitHub API;
    - no `pull_request_target`; least-privilege permissions; `persist-credentials: false`; `set -euo pipefail`;
    - the full gate is read from `.agents/gates.json`, not duplicated in YAML.
  - **Linting:** actionlint clean. zizmor (`--offline`): only deliberate pedantic LOW findings remain; not re-run with the default persona after the final edits.
  - **Skip behaviour:**
    - Preview jobs are skipped unless all preview secrets and variables exist.
    - Production is skipped unless the repository variable `PRODUCTION_DEPLOY_ENABLED=true`, because environment secrets aren't visible to a config-check job outside the environment. Once enabled, missing secrets make the job fail, not skip.
  - **Coordinator verification:**
    - `run-gate.sh fast` → PASSED.
    - The proposed full command (with `smoke:node` and `scan:secrets`) in a clean environment exited 0: 209 unit, 49 integration and 42 E2E tests, the smoke test, Lighthouse, the audit at HIGH, and no leaks.
  - **Unverified until Stage 2/3:**
    - the Vercel CLI flow (`--prebuilt` runtime env, `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` handling);
    - preview aliasing `<PREVIEW_ALIAS_PREFIX>-pr-<N>.vercel.app` (needed because `BETTER_AUTH_URL` must be known before the deploy);
    - Neon action re-run and missing-branch behaviour;
    - alias cleanup isn't implemented.
  - **Owner decisions on T4** (Ashley Oliver, 2026-10-06):
    1. **Approved gate change:** `full` adds `pnpm smoke:node` (after `build:vercel`) and `pnpm scan:secrets` (last). The duplicate CI steps and job are removed, so CI runs them only through the gate.
    2. **The Vercel CLI becomes an exact, locked devDependency** executed from the lockfile in CI (no `pnpm dlx`).
    3. **`PRODUCTION_DEPLOY_ENABLED` is the explicit production switch.** Off by default. Once enabled, missing production configuration fails rather than skipping.
    4. **The repository-level preview Vercel token is accepted for F0,** subject to the Stage 1 GitHub controls for outside collaborators and forks, and to the final security review of the exact workflow triggers and permissions.
    5. **`NEON_API_KEY` and `NEON_PROJECT_ID` are removed from Stage 3.** Production gets database URLs only, with no Neon management credentials.
    6. **Predictable PR preview aliases are accepted provisionally,** to be verified at Stage 2. Alias cleanup is follow-up operational hygiene unless Stage 2 shows it's needed for correctness or security.
    7. **zizmor is re-run with its default security analysis** on the final workflows before the commit. Meaningful findings are investigated, not merely suppressed.
    8. **`.gitleaksignore` stays limited to the 11 reviewed exact fingerprints** (no wildcard, path or rule suppressions) and is included in the final security review.
- **Prove results** (2026-10-06, HEAD 4fc5d37):
  - **QA:** PASS locally, with one MEDIUM gap (no automated 503 test for database unavailability).
  - **Security:** no BLOCKER; ready for Stage 1 subject to the Stage 1 GitHub settings. All action pins verified against official commits, with no advisories. Whether each pin is the *latest* version is **UNVERIFIED** (a guard false positive blocked that check). All 11 `.gitleaksignore` fingerprints were verified as test-only throwaway values.
  - **Findings:**
    - F1 HIGH (blocks Stage 2): the preview Vercel token could act on production.
    - F2 MEDIUM (Stage 3): the `production` environment needs a deployment-branch policy.
    - F3 MEDIUM (Stage 2): preview would hold the production Google client secret.
    - F4 LOW: the Neon delete action installs an unpinned `neonctl`.
    - F5 LOW: dev-tooling advisories; Vercel CLI cooldown.
    - F6 LOW: squash/rebase merging invalidates the gitleaks fingerprints.
    - F7 LOW/INFO: gate integrity relies on review.
    - INFO: CI concurrency; Postgres image pinned by tag.
- **Owner decisions after Prove** (Ashley Oliver, 2026-10-06):
  - **A (pre-Stage-1 remediation): approved.**
    - A1: 503 test.
    - A2: README correction.
    - A3: CI concurrency and Postgres digest.
    - A4: replace the Neon delete action.
    - A5: remove `VERCEL_TOKEN` from `vercel build` **only if** documented CLI behaviour and local evidence support it. Otherwise it's a Stage 2 item. No guessing.
    - A6: pin a Vercel CLI version satisfying the 7-day cooldown; add a non-blocking full dev-dependency audit as CI evidence; document the dev-tooling advisories as accepted F0 risk. No fixing of the CLI's transitive dependencies. The production-dependency HIGH audit stays blocking.
    - A7: spec updates.
    - A8: AC1 fresh-clone dev start and AC2 timing.
    - A9: verification and commit.
  - **B/F1:** preview deployments use a structurally separate Vercel team or account with no production project (ADR-0003 amended). No Vercel resources until Stage 2.
  - **B/F3:** investigate, using the installed Better Auth source, whether preview OAuth needs the Google client secret.
    - If it doesn't, prove a client-ID-only preview design, including a negative test.
    - If it does, exposing the production Google client secret to preview workflows is **not** accepted automatically.
    - Report before Stage 2.
  - **C/F2:** before Stage 3, the `production` environment must require owner approval **and** restrict deployments to `main`.
  - **Stage 1: conditionally approved.** Conditions: after the remediation commit, the committed full gate passes, the tree is clean, and there's no new BLOCKER/HIGH affecting Stage 1. Then:
    1. The owner applies the GitHub settings: ruleset, merge commits only, Actions restrictions, no write collaborators, secret scanning with push protection, Dependabot security updates.
    2. After the owner confirms the settings, the coordinator asks for explicit approval of `git push -u origin work/WORK-001-f0-foundation`.
    3. A draft PR; observe the first CI run.
    - No merge, Stage 2 resources, secrets or deployment are authorised.
  - **Post-F0 evidence:** exact gitleaks fingerprints currently constrain the merge strategy whenever commits are rewritten. Not redesigned during WORK-001.
- **Prove remediation A results** (2026-10-06):
  - **A1:** 503 behaviour proven by E2E. A fail-open sign-out was found and fixed (see the T3-review INFO note above). E2E now 47 tests.
  - **A2:** README corrected:
    - preview secrets are readable by same-repo branch workflows and build code;
    - the separate Vercel scope (F1);
    - the `production` environment's approval and `main` restriction (F2);
    - merge commits only (F6);
    - `pnpm db:migrate` added to Setup (a gap found by the AC1 run).
  - **A3:** concurrency is now per job (quality cancels only superseded PR runs; `main` runs get their own groups; production stays serialised and non-cancelling). Postgres is pinned by digest `sha256:9a8afca5…de15` in CI and docker-compose. **Unverified until the first GitHub run:** how a production job waiting for approval interacts with its group.
  - **A4:** the Neon delete action is replaced by direct REST calls.
    - The key is passed in a header via stdin.
    - 404 counts as success.
    - The branch id is validated, and default branches are refused.
    - **Unverified until Stage 2:** the `default` field name in list responses, the 404 body, the 423 "locked" handling, and pagination beyond 100 branches.
  - **A5: not done** (owner rule). Vercel's docs don't clearly say `vercel build` works without a token. **Stage 2 item:** test `vercel build` with only `.vercel/` from `vercel pull` and no token; drop the token from the build steps if that works.
  - **A6:**
    - `vercel` pinned to **61.0.0** (published 2026-09-29, the newest version ≥7 days old); no new dependency build scripts.
    - A non-blocking full dependency audit is added to CI and reported in the job summary.
    - Production audit unchanged (1 moderate, accepted).
    - **Accepted F0 risk (owner decision A6):** the full audit of all dependencies reports 9 low, 27 moderate, 23 high and 1 critical (45 distinct advisories). 37 come through the `vercel` CLI devDependency (e.g. `tar` critical, `undici`, `minimatch`, `js-yaml`, `path-to-regexp`); the rest through `@lhci/cli` and other dev tooling, plus the accepted esbuild advisory.
    - The exposure is CI-only tooling that holds deploy tokens, and the advisories sit mostly in code paths the CLI doesn't use. Transitive fixes are not in scope.
    - Reassess on CLI upgrades (Dependabot, with a 7-day cooldown) and before F5.
  - **A7:** spec updated (R7, R13, R18/AC10, Stage 2/3 configuration, Testing, statuses, Review state); `.env.example` comment updated.
  - **A8:**
    - **AC1 PASS:** fresh clone → `pnpm install --frozen-lockfile` → `.env` → `pnpm dev` served `/` with 200 in 3s. `docker compose up` was skipped in the clone because the repository's own containers already hold 5433/5434.
    - **AC2 PASS:** fast gate 4s.
  - **Linting:** actionlint clean; zizmor default persona no findings (offline only; network audits not run).
  - **A9:** coordinator `run-gate.sh fast` → PASSED (4s). The working-tree `full` in a clean environment exited 0: 209 unit, 49 integration and 47 E2E tests, the smoke test, Lighthouse, the audit at HIGH, and no leaks.
- **Local Postgres prerequisite:** integration tests must fail fast with a clear, actionable message (e.g. "PostgreSQL is not reachable at <host:port>; run `docker compose up -d`") when the database is unavailable, instead of an obscure test failure. Keep it a lightweight pre-check, not new orchestration (assigned to T2).
## Review state
<!-- maintained by /ai-engineering:review: gates, security, QA, EXTERNAL REVIEW status -->
- **Prove (deliver), 2026-10-06, HEAD `4fc5d37`:**
  - Committed `full` gate PASSED.
  - QA: PASS locally, with one MEDIUM gap (503 test).
  - Security review: no BLOCKER; ready for Stage 1 subject to the GitHub settings. F1 (HIGH) blocks Stage 2.
  - Details are under "Prove results" in Implementation state; the remediation is in progress.
- **External review:** not configured (`externalReview: null`). The independent `/ai-engineering:review` hasn't run yet.
- **Not verifiable locally (Stage 2/3):** AC4, AC5, AC6 on production, AC7, AC9, R14–R17 on the platforms, and the Stage 2 verification items.
- **Prove remediation** (`312665c`, `a159f20`): committed `full` gate PASSED. `312665c` hasn't been independently security-reviewed yet; that review is due before Stage 2.
- **Stage 1 complete** (2026-10-06):
  - The owner applied the GitHub settings: ruleset, merge commits only, Actions restrictions, no write collaborators, secret scanning with push protection, Dependabot security updates.
  - Push approved by the owner ("approve push"): `work/WORK-001-f0-foundation` pushed at `a159f20`; `main` unchanged at `fd71610`.
  - Draft PR #1 (https://github.com/asholiver/landra/pull/1).
  - **First GitHub CI run** (#37436826169) on `a159f20`: **success.**
    - Quality gate success. The full gate passed on Linux, including the Docker gitleaks full-history scan, the Vercel CLI from the lockfile, `smoke:node`, E2E with axe, and Lighthouse. **AC3 now PASSES on GitHub.**
    - Preview configuration check success. Preview deployment, preview comment, production configuration check and production deployment all skipped, as designed.
    - Job-summary text was not readable without authentication.
  - **`main` ruleset, verified via the public rules API:**
    - deletion and force pushes blocked;
    - PR required, merge commits only, review threads resolved;
    - required status check `Quality gate (full gate incl. Node smoke and secret scan)` bound to GitHub Actions (integration 15368), with "up to date before merging" on.
  - **Not authorised:** merging, Stage 2 resources, secrets, deployment.
- **F3 outcome** (2026-10-06; investigated against the installed better-auth 1.7.7 with file and line evidence):
  - **What the preview does:**
    - Sign-in start builds the authorization URL with the client ID, state and an S256 PKCE challenge. It never includes the client secret.
    - The OAuth proxy rewrites `redirect_uri` to the production callback, so production does the code exchange.
    - The preview only decrypts the proxied profile at `/callback/:id/oauth-proxy`.
    - **The preview never needs the Google client secret.**
  - **The one coupling:** Better Auth's Google provider throws if `clientSecret` is empty when building the authorization URL. A proxy preview therefore passes a fixed, non-secret placeholder (`unused-on-proxy-preview`).
  - **Safeguard:** a secretless deployment refuses, with 404, every route that would send the secret to Google: `/callback/:id`, `/refresh-token`, `/get-access-token`, `/account-info`.
  - **Config rule:** the client ID alone is accepted **only** for a proxy preview. That means `OAUTH_PROXY_SECRET` and `OAUTH_PROXY_PRODUCTION_URL` are set, the proxy production origin differs from `BETTER_AUTH_URL`'s, and `VERCEL_ENV !== "production"`. Production and non-proxy deployments still require both values. A secret without an ID is rejected.
  - **Tests:**
    - 8 config unit tests;
    - 8 integration tests, including a NEGATIVE test: the four routes return 404 and a stubbed `fetch` records zero outbound calls; the placeholder appears in neither the URL nor cookies.
  - **Workflow and docs:** CI no longer requires or passes `PREVIEW_GOOGLE_CLIENT_SECRET`. README and `.env.example` updated.
  - **Risks:**
    - The behaviour depends on better-auth internals, so re-run the negative tests on any Better Auth upgrade.
    - A preview *may* still hold the real secret if one is configured. That isn't hard-forbidden, so that local development with real credentials keeps working.
  - **Unverified until Stage 2:** the real preview → Google → production → preview flow, and the `VERCEL_ENV` value on previews.
  - **Status:** uncommitted, pending security review of the diff.
  - **Independent review of the F3 diff** (2026-10-06): **OK to commit; no BLOCKER or HIGH.**
    - The placeholder has no route to Google. The only secret users are `validateAuthorizationCode` and `refreshAccessToken`, and every route that calls them is guarded.
    - User hooks run before plugin hooks.
    - Path matching uses route templates.
    - ID-token sign-in is verified against Google's JWKS.
    - Production can only be misclassified through misconfiguration, which fails closed.
    - HIGH-4 and L-B are not weakened.
    - Findings, being fixed:
      - **F3R-M1 (MEDIUM):** the zero-outbound-fetch test can't fail, because the requests are rejected earlier anyway. Real-state and seeded-token tests to be added, and shown to fail when the guard is removed.
      - **F3R-L1 (LOW):** the "no secret on previews" convention isn't enforced. Config will reject `GOOGLE_CLIENT_SECRET` on a proxy preview, per the owner's rule against automatic exposure.
      - **F3R-L2 (LOW):** the guard list is tied to better-auth 1.7.7. An endpoint-enumeration test will force review on upgrade.
    - **Fix results** (2026-10-06, backend agent; each new test was shown to fail when its fix was disabled, then reverted):
      - **312665c-M1:** controls added to `database-unavailable.spec.ts`: a foreign Origin gets 403; get-session with no cookie gets 200 null. With a broken config, the 5 old 503 tests passed vacuously while both controls failed.
      - **312665c-L1:**
        - `sign-out.ts` now calls `internalAdapter.deleteSession` by the verified token, which throws on failure, *before* `signOut` clears the cookie. That closes the read-then-delete race.
        - New `sign-out-route.test.ts`: the session read uses real Postgres; the delete failure is injected by stubbing `deleteSession` (owner-approved non-destructive injection, chosen over DB DDL). Result: 503, no Set-Cookie, the row remains, `signOut` is not called. With the fix disabled, the test failed (302 instead of 503).
        - A first attempt bundled a heredoc file write, formatting, a test run and SQL DDL text in one shell command. The owner **denied** it; it wasn't resubmitted.
      - **F3R-M1:** real-state callback and seeded expired-token tests. With the guard disabled, all 4 failed, recording a request to `oauth2.googleapis.com/token`.
      - **F3R-L1:** config rejects `GOOGLE_CLIENT_SECRET` on a proxy preview, naming the variable only. Local and non-proxy deployments are unaffected.
      - **F3R-L2:** `auth-endpoints.test.ts` checks endpoints against an allowlist of 32 reviewed `auth.api` paths (better-auth 1.7.7).
      - **Review L2 (coordinator):** `preview-cleanup.yml` concurrency group changed to `preview-<PR>`, shared with the preview job. actionlint clean.
      - **Agent verification:** 219 unit, 62 integration and 49 E2E tests passed, plus lint, typecheck and both builds.
    - **Third independent review** of the full uncommitted diff (2026-10-06): **OK to commit; no BLOCKER, HIGH or MEDIUM.**
      - Reviewer runs: 219 unit, 62 integration and 49 E2E tests passed.
      - Sign-out has no remaining fail-open path, cookie attributes are unchanged, and the stub-based test can fail.
      - F3R-M1, L1 and L2 hold.
      - **Remaining LOW (follow-up before Stage 2):** a PR closed while CI is still in `quality` can still get a preview branch and deployment, because the preview job joins `preview-<N>` only after `quality`. Proposed fix: the preview job's first step checks that the PR is still `open` (`pull-requests: read`) and skips otherwise. Bounded by the 14-day branch expiry.
      - INFO: assert that `deleteSession` was called with the seeded token.
      - UNVERIFIED by the reviewer: re-running the guard-disabled proof; live cross-workflow concurrency.
    - Optional Stage 2 check: fail CI if the preview Vercel project's env contains `GOOGLE_CLIENT_SECRET`.
    - **Committed** as `f006ff4`. The first committed gate run **FAILED**: gitleaks flagged a new hard-coded proxy-secret test fixture in `auth-endpoints.test.ts`.
      - Cause: the secret scan reads committed history only, so the passing working-tree gate couldn't see it.
      - Fix: the fixture is generated at runtime, and the *unpushed* commit was amended (`656f1d8` → `f006ff4`), so the literal never entered history and `.gitleaksignore` stays at the 11 approved fingerprints.
      - Committed `full` gate then PASSED (18 commits scanned, no leaks).
- **Owner decisions before Stage 2** (Ashley Oliver, 2026-10-06):
  - **L3:** the F0 policy stays as documented: the 7-day cooldown applies to the direct `vercel` dependency. No whole-lockfile `minimumReleaseAge` during WORK-001. Whole-lockfile dependency-age policy is a post-F0 review candidate.
  - **Closed-PR preview race:** fix before Stage 2. Immediately before preview provisioning, verify the PR is still open and skip safely if it isn't. Permission limited to `pull-requests: read`. Reviewed, gated, committed locally, not pushed.
    - **Implemented** (platform agent):
      - The first `preview` step checks the PR state through the GitHub API.
      - `REPOSITORY` and `PR_NUMBER` are passed via env, and the PR number is digit-validated.
      - `open` provisions; any other state gives a summary line and every later step plus `preview-comment` skipped, with a green run.
      - An API failure fails the job (fail closed).
      - `pull-requests: read` is added on `preview` only.
      - actionlint clean; zizmor default persona (offline) no findings.
    - **Fourth independent review:** OK to commit; no BLOCKER, HIGH or MEDIUM.
      - The `set -e` assignment really fails the step.
      - All 11 later steps and `preview-comment` are gated; no secret-using step runs for a closed PR.
      - The required Quality gate is unaffected.
      - Both orderings are closed.
      - **Residual LOW:** if a later run's preview job joins the group while a cleanup is pending behind a running preview, GitHub cancels the pending cleanup, and the branch is orphaned until its 14-day expiry. Recommended: accept and document (README updated). Alternatives (a cleanup step inside the preview job, which would use secrets for a closed PR, or a scheduled sweep) are post-F0 options.
      - UNVERIFIED: live GitHub cross-workflow pending-cancel behaviour; `gh` on the runner (preinstalled on GitHub-hosted runners). If a `PREVIEW_GOOGLE_CLIENT_SECRET` repository secret is ever created, delete it.
- **Independent security review of `312665c`** (2026-10-06): **accepted before Stage 2; no BLOCKER or HIGH.**
  - **Verified:**
    - the sign-out Origin and CSRF behaviour is unchanged, with the cookie cache off;
    - CI concurrency keys can't be influenced by a PR;
    - the informational audit can't hide a gate failure;
    - the Neon cleanup keeps the key out of argv, URLs and logs, validates the project, PR and branch ids, refuses default branches, uses `permissions: {}`, and can't be triggered by a fork;
    - the Postgres digest;
    - no install scripts;
    - README security wording is accurate.
  - **Findings:**
    - **M1 (MEDIUM):** `database-unavailable.spec.ts` can pass vacuously when config is invalid, because ConfigError gives the same 503. Being fixed with a valid-config control.
    - **L1 (LOW, security):** sign-out is still fail-open when the database accepts reads but rejects writes, because Better Auth `signOut` swallows `deleteSession` failures. Being fixed: delete the session explicitly before clearing the cookie, with a test that blocks deletes.
    - **L2 (LOW):** a PR closed while its preview is still being created can leave a Neon branch behind until it expires. Fix: share the concurrency group between preview and cleanup.
    - **L3 (LOW):** the 7-day cooldown is met only by `vercel` itself; `@vercel/oidc` and `@vercel/cli-config` were under 4 days old. **Clarification:** the A6 cooldown statement covers the direct `vercel` dependency only, not its transitive tree. Whether to enforce it lockfile-wide (pnpm `minimumReleaseAge`) is an open owner decision. Reword the claim; whole-lockfile enforcement (pnpm `minimumReleaseAge`) is an owner decision.
  - **INFO:**
    - the informational audit's summary shows an empty block if `pnpm audit` fails;
    - Dependabot doesn't track Docker image pins;
    - **UNVERIFIED:** Neon API `search`/`limit` semantics and DELETE idempotency, and whether a skipped production job ever enters its concurrency group.
  - **Open before Stage 2:**
    - the F3 investigation;
    - a security review of `312665c`;
    - the separate Vercel team or account (F1);
    - Stage 2 verification items.
    - Also verify in CI: how concurrency behaves while production awaits approval.
- **External independent review: CodeRabbit on PR #1** (2026-10-06):
  - **Scope:** review `5427295079` by `coderabbitai[bot]` covers `fd71610..64fbb11` (commit_id `64fbb11e9c743b8ec1c2039cb974fe0aaf23555b`), 135 files, default configuration, CHILL profile. CodeRabbit is independent of Claude, and its comments were treated as untrusted data and verified against the code.
  - **Result:**
    - merge risk Low;
    - security architecture risk Moderate, with **no retained architecture-level concerns**;
    - 3 actionable findings, all Minor;
    - pre-merge checks 4 passed, 1 inconclusive (docstrings).
  - **Findings and dispositions** (CR-1 in this record's commit, CR-2 in `5c92dad`, CR-3 in `1f65209`):
    - **CR-1, valid, LOW (docs):** line 243 listed `PREVIEW_GOOGLE_CLIENT_SECRET` among the Stage 2 secrets, contradicting the F3 outcome and line 245. Following it would make a proxy preview refuse to start (F3R-L1). README, `.env.example` and CI were already correct. Fixed: removed from the list.
    - **CR-2, valid, LOW:** `drizzle.config.ts` used `??`, so an empty `DATABASE_URL_UNPOOLED` gave drizzle-kit an empty URL, while `scripts/migrate.ts` (`||`) and `config.ts` (empty means unset) fall back. Practical impact is nil today, because `pnpm db:generate` doesn't connect. Fixed: `||`, plus `tests/unit/drizzle-config.test.ts`, which fails with `??`.
    - **CR-3, valid, LOW (outside the diff):** AGENTS.md still said the gates were placeholders and the commands TBD. Fixed in a separate commit: factual commands only, `gates.json` stays authoritative, and no learnings were promoted (D19).
  - **Hardening proposals, classified:**
    - **Raw auth API identity changes: already covered, but the evidence had a WORK-001 gap.** Verified in better-auth 1.7.7 source:
      - `/update-user` always refuses an `email` field;
      - `/change-email` and `/delete-user` are disabled unless enabled in options, which this app never does;
      - linking requires the same email unless `allowDifferentEmails` is set (`api/routes/account.mjs:211`, `oauth2/link-account.mjs:47`).

      No test pinned these defaults, so the new `tests/integration/identity-changes.test.ts` does. It has a control that proves the session is valid, plus refusals that assert the error code and unchanged rows. With `changeEmail` and `deleteUser` temporarily enabled, 2 of 4 failed; the code was reverted with no diff. The linking default isn't automated, because it needs a Google round trip; re-check it on any Better Auth upgrade together with `auth-endpoints.test.ts`.
    - **Refusing unused raw routes and raw `/api/auth/sign-out` failure behaviour: later roadmap (F5).**
      - Only the allowlisted owner can reach these routes, and only for their own session.
      - The app's `/sign-out` already fails closed.
      - `auth-endpoints.test.ts` forces a review when a route is added.
      - Added to the F5 row as a "before anyone else gets access" item. Aligning DB checks for direct identity writers is also F5: the only direct writer today is the allowlist CLI.
    - **Preview credential scopes and `production` environment protections against the real accounts: Stage 2/3 verification.** Already listed (F1 separate Vercel scope; F2 approval and `main` only).
    - **Provisioning retries, interrupted cleanup, and failure after migrations or deploy: Stage 2 verification.** Partly listed already (concurrency, closed PR, Neon API details). Added: re-run a preview job for the same PR (branch reuse and idempotent migrate), cancel a preview mid-run, and re-run a failed cleanup.
    - **Production recovery procedure that keeps authentication invariants across an application rollback: genuine WORK-001 gap, due before Stage 3.**
      - It needs the real production project and an owner decision on rollback policy. For example: migrations are forward-only and must stay compatible with the previous deployment; a Vercel rollback is allowed; a Neon point-in-time restore must be followed by re-checking the allowlist and revoking sessions.
      - Write it as a short README runbook before `PRODUCTION_DEPLOY_ENABLED=true`.
  - **Docstring coverage (54.43% against CodeRabbit's generic 80%): not adopted.** Neither the project standards nor the spec require docstrings. Comments explain non-obvious behaviour only. CodeRabbit's configuration is not changed, so its independence is not reduced.
  - **How `/ai-engineering:review` sees this:**
    - It recognises external review only through `externalReview` in `.agents/gates.json` at the base ref, and that is `null` on `main`. It will report **EXTERNAL REVIEW: NOT CONFIGURED**.
    - This record is evidence for the owner's final acceptance, not a PASSED verdict.
    - Wiring CodeRabbit in would be a gate change for the owner. For example, a command that passes only when a CodeRabbit review exists for the exact head SHA with no unresolved actionable threads. It takes effect only once it is on `main` (post-F0 roadmap item).
  - **Still required:** CodeRabbit's incremental review of the remediation commits after they are pushed. `64fbb11` is reviewed; the new head is not yet.
