# Architecture overview

Product name undecided; "landra" is the repository's working name only.

## Shape
One TypeScript codebase and one deployment (ADR-0001, ADR-0004):
- **Public routes:** pre-rendered marketing/sign-in pages with minimal client JS. Not indexed until naming and F15 are complete.
- **App routes (`/app/...`):** authenticated, server-rendered with client interactivity.
- **Server modules (`src/server/`):** framework-agnostic business logic and data access. Route loaders and actions stay thin.

## Stack
| Concern | Choice | Record |
|---|---|---|
| Language | TypeScript (strict) | D2 |
| UI | React, React Router v7 framework mode (Vite) | ADR-0001 |
| Forms/validation | react-hook-form + zod schemas shared with the server | D2 |
| Lint/format | Biome | D2 |
| Runtime | Node.js | D2 |
| Database | PostgreSQL on Neon Free, London | ADR-0003 |
| ORM/migrations | Drizzle + drizzle-kit, reviewed SQL migrations | ADR-0003 |
| Auth | Better Auth in our Postgres; Google OAuth; allowlist | ADR-0002 |
| Hosting | Vercel Hobby, functions in `lhr1`; Node build proven in CI | ADR-0001 |
| CI | GitHub Actions (public repository) | WORK-001 |

## Binding rules
- No Vercel-proprietary application services; Vercel-specific code is limited to build config and `vercel.json`.
- Every user-owned table has `user_id`; every data-access function is scoped by the acting user's id.
- Migrations are generated, reviewed as SQL, applied by CI, and backward-compatible with the running version. Never `drizzle-kit push` to shared databases.
- No secrets or personal data (including allowlisted emails) in the repository. The repository is public.
- Product name comes from one config constant; never hard-code the working name in UI copy.
