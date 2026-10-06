# landra

AI-powered job search workspace, built using agent-driven software development.

## Setup

Prerequisites: [nvm](https://github.com/nvm-sh/nvm), [Corepack](https://nodejs.org/api/corepack.html) (bundled with Node) and Docker.

```sh
nvm install        # installs the Node version in .nvmrc
nvm use
corepack enable    # provides the pnpm version pinned in package.json
pnpm install
docker compose up -d
cp .env.example .env   # then fill in BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm db:migrate        # applies the committed SQL migrations to the local dev database (port 5433)
pnpm dev
```

The app is served at http://localhost:5173. Postgres runs in Docker on port 5433 (see `docker-compose.yml`); `/app` needs the migrations above.
Google credentials are optional outside production. To sign in locally you need Google credentials in `.env` and your email on the approved list: `pnpm allowlist add <your-email>`.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` | Standard Node production build (`pnpm start` serves it) |
| `pnpm start` | Serves the Node build with `server/node-server.ts` (static files and the app, same security headers) |
| `pnpm build:vercel` | Build with the Vercel preset |
| `pnpm lighthouse` | Builds, then Lighthouse CI on `/` and `/sign-in` (Performance, Accessibility, Best Practices at least 0.98; uses Playwright's Chromium) |
| `pnpm lint` / `pnpm format` | Biome check / check and fix |
| `pnpm typecheck` | Route type generation and `tsc` |
| `pnpm test` | Unit tests |
| `pnpm smoke:node` | Builds, runs `pnpm start` on a free port with explicit non-secret config, checks `/` and `/healthz` (200 and shared headers), stops it |
| `pnpm scan:secrets` | Scans the full git history for secrets (gitleaks, pinned Docker image; needs Docker) |
| `pnpm test:integration` | Integration tests; need the disposable test database (see below) |
| `pnpm test:e2e` | Playwright E2E (incl. axe) against the production Node build; needs the disposable test database, see below (first run: `pnpm exec playwright install chromium`) |

## Approved list (allowlist)

Only emails on the approved list can have an account. Manage it with:

```sh
pnpm allowlist add <email>
pnpm allowlist remove <email>
pnpm allowlist list
```

Emails are trimmed and lower-cased. `remove` is a single database transaction: it removes the email from the approved list and revokes every existing session of the user with that email, so access ends on their next request (session cookies are not cached). It prints what happened, for example `Removed x@example.com from the approved list and revoked 2 active session(s).` If the transaction fails, neither change is kept. A database trigger also refuses to create any session for an email that is not on the list, so a sign-in racing a removal cannot leave a valid session behind. The user's account row is kept (data is not deleted); adding the email again lets them sign in again.

## Integration tests

Integration tests use a separate, disposable Postgres (`postgres-test`, port 5434, data in tmpfs), never the development database:

```sh
docker compose up -d postgres-test
TEST_DATABASE_URL=postgresql://app:app@127.0.0.1:5434/postgres pnpm test:integration
```

`TEST_DATABASE_URL` is required (there is no default). Each run creates its own `it_<random>` database, migrates it, and removes only that database afterwards. The run refuses to start against any other port, a non-loopback host, the app's `DATABASE_URL`, a Neon host, or a server that lacks the disposable-server marker.

## End-to-end tests

```sh
docker compose up -d postgres-test
TEST_DATABASE_URL=postgresql://app:app@127.0.0.1:5434/postgres pnpm test:e2e
```

The Playwright global setup builds the Node server, creates and migrates its own `it_<random>` database with the same safeguards as the integration tests, starts the server with explicit, non-secret test configuration (never `.env` or your shell), and removes the database afterwards. Signed-in tests seed a user and session directly in that database (`tests/support/session.ts`); real Google OAuth is not automated.

## Security headers and the two serving paths

`src/server/http/security-headers.ts` is the single definition of the response headers (noindex, CSP, HSTS, nosniff, referrer and permissions policies).

- Pages rendered by React Router (document, data and resource requests, the 404 page) get them, plus an `X-Request-Id` and a log line, from the root middleware (`app/lib/request-scope.server.ts`). Inline scripts there carry a per-request CSP nonce.
- Prerendered pages (`/`, `/sign-in`) are static files, so no per-request nonce is possible. They ship no inline script at all (no hydration; the only script is `public/sign-in.js`), so their CSP is just `script-src 'self'`. Locally `server/node-server.ts` serves them and applies the shared headers. On Vercel, `vercel.json` carries the identical headers for statically served paths; a unit test keeps it equal to the shared definition.

## CI/CD

Workflows: `.github/workflows/ci.yml` (everything on PRs and `main`) and `.github/workflows/preview-cleanup.yml` (PR closed). They use `pull_request`, never `pull_request_target`, so PRs from forks get no secrets and no preview. Third-party actions are pinned by commit SHA; Dependabot proposes updates weekly.

Quality gates (`fast`, `full`) are defined only in `.agents/gates.json`; run the commands listed there. CI reads the `full` command from that file, so the command text is never duplicated.

| Stage | When it runs | What happens | Needs |
|---|---|---|---|
| 1. CI | Every PR and push to `main` | The `full` gate with a disposable Postgres. The gate includes the Node build smoke test (`pnpm smoke:node`: `pnpm start` must serve `/` and `/healthz` with the shared headers) and a full-history secret scan (`pnpm scan:secrets`, gitleaks in a digest-pinned Docker image), so CI checks out the full history and runs nothing twice | No secrets |
| 2. Preview | PRs from this repository, after Stage 1 passes | A branch in the separate **preview** Neon project, migrations on it, a Vercel preview deployed from prebuilt output with preview-only configuration, and the URL posted on the PR. Closing the PR deletes the branch | Preview secrets and variables below |
| 3. Production | Push to `main`, after Stage 1 passes | Waits for the owner's manual approval in the GitHub `production` environment, then production migrations, the production deployment and a `/healthz` check that must report the deployed commit | Production environment below |

Vercel's own Git auto-deploys are disabled (`vercel.json`), so deployments happen only through CI, after the gates.

**Skipped, not passed.** Until the secrets exist, the preview jobs and the production job are skipped (shown as skipped in GitHub, with a step summary saying why). A merge to `main` never changes production by itself: the production job always waits for approval.

Required configuration (names only; never commit values):

- Stage 2: a **separate Vercel team or account for previews, with no production project in it** (owner decision). Repository secrets: `PREVIEW_VERCEL_TOKEN` (a token of that preview scope only), `PREVIEW_VERCEL_ORG_ID`, `PREVIEW_VERCEL_PROJECT_ID`, `PREVIEW_NEON_API_KEY`, `PREVIEW_NEON_PROJECT_ID`, `PREVIEW_BETTER_AUTH_SECRET`, `PREVIEW_OAUTH_PROXY_SECRET`, `PREVIEW_GOOGLE_CLIENT_ID` (the same Google client ID as production, which is public; there is deliberately **no** preview Google client secret: previews never exchange the code, production does, F3; the app refuses to start on a proxy preview that is given one). Repository variables: `PREVIEW_OAUTH_PROXY_PRODUCTION_URL`, `PREVIEW_ALIAS_PREFIX`.
- Stage 3: the GitHub `production` environment must require the owner's approval **and** restrict deployment branches to `main` (owner decision). In it, secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED`, `BETTER_AUTH_SECRET`, `OAUTH_PROXY_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the environment variable `PRODUCTION_URL` (https origin, no trailing slash). Set the repository variable `PRODUCTION_DEPLOY_ENABLED=true` last. No `NEON_*` values are needed for production.

What protects what, accurately:

- **Preview secrets are repository secrets.** Workflows run from branches of this repository, and the code they build and run, can read them. Anyone who can push a branch to this repository can use them, so they must be able to do no harm to production: previews have their own Neon project, their own auth and proxy secrets, and (Stage 2) a Vercel scope that contains no production project, so the preview token cannot touch production.
- **Production secrets exist only in the `production` environment.** A job can read them only after the owner approves it, and only when it runs from `main`. Workflows on other branches cannot read them.
- With `PRODUCTION_DEPLOY_ENABLED=true`, any missing production secret or variable fails the job once it is approved (it is never silently skipped).
- Keep the repository on **merge commits only** (no squash or rebase): the `.gitleaksignore` fingerprints contain commit hashes, which squashing or rebasing would change.

The Vercel CLI is a pinned devDependency (`pnpm exec vercel`), so CI uses the version in the lockfile. CI also writes an informational, non-blocking audit of all dependencies (including dev tooling) to the job summary; only the production audit at high severity blocks.

### Secret scan suppressions

`.gitleaksignore` holds exact finding fingerprints only (`<commit>:<file>:<rule>:<line>`), each reviewed one by one and justified in a comment. Never add wildcard, path or rule-level ignores. Existing entries are throwaway test fixtures committed in history; a new finding is fixed (or the value changed to a clearly fake one) before any suppression is considered.

### Follow-up: preview alias cleanup

Closing a PR deletes its Neon branch, but the Vercel alias (`<PREVIEW_ALIAS_PREFIX>-pr-<N>.vercel.app`) and its deployment are not removed yet. They no longer have a database behind them; removing them automatically is a planned follow-up.
