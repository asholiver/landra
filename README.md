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
pnpm dev
```

The app is served at http://localhost:5173. Postgres runs in Docker on port 5433 (see `docker-compose.yml`).
Google credentials are optional outside production.

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

Quality gates (`fast`, `full`) are defined only in `.agents/gates.json`; run the commands listed there.
