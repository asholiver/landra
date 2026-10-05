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
| `pnpm build:vercel` | Build with the Vercel preset |
| `pnpm lint` / `pnpm format` | Biome check / check and fix |
| `pnpm typecheck` | Route type generation and `tsc` |
| `pnpm test` | Unit tests |
| `pnpm test:integration` | Integration tests (need `DATABASE_URL`) |
| `pnpm test:e2e` | Playwright E2E against the production Node build (first run: `pnpm exec playwright install chromium`) |


Quality gates (`fast`, `full`) are defined only in `.agents/gates.json`; run the commands listed there.
