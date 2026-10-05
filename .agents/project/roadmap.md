# Product roadmap

Product name: **not yet chosen**. "landra" is only the repository's working name and must not become the product name by default. Use "the product" until a name is agreed.

Living document. Each feature is planned and delivered as its own work item (`/ai-engineering:plan` → spec → `/ai-engineering:deliver`). Work IDs are assigned when a feature enters planning.

## Identifier rules
- Feature IDs (`F<n>`) are **permanent**. Never renumber or reuse one.
- New features take the next unused number, wherever they sit in the sequence.
- Delivery order is the order of rows within and across phases, not the numeric order.
- Dropped features keep their ID with status `dropped`.
- Next unused ID: **F17**.

Status key: `idea` · `planned` (WORK-ID assigned) · `approved` · `in progress` · `done` · `dropped`

## Product shape (ADR-0004)
- **Public site** (signed out): explains what the product does, who it's for and why it's useful, with calls to action to sign in or request access. Pre-rendered, SEO-friendly, Lighthouse ≥98, and visually polished.
- **Application** (signed in, under `/app`): the job-search workspace. Never indexed.
- One codebase and one deployment with a shared design system. Not indexed by search engines until the product is named and F15 ships.

## Phase 1: MVP (deployed, usable by the owner, demoable)
Success: the owner can use the product from any device at a free public URL to track a real job search, and show it to others. Infrastructure cost is £0.

| ID | Feature | Summary | Status |
|---|---|---|---|
| F0 | Foundation | Scaffold, CI and quality gates, production and preview deploys, Postgres and migrations, Google sign-in restricted to an allowlist, a simple placeholder public page plus a sign-in page, an authenticated app shell, health check, site-wide noindex | approved (WORK-001) |
| F1 | Opportunities | Create, edit and delete an opportunity: company, role, URL, source, location, salary range, pasted job description, deadline. **Includes automated database backups beyond Neon's 6-hour restore window, in place before real data is relied on** | idea |
| F2 | Pipeline board | Saved → Applied → Interviewing → Offer. Drag-and-drop plus a keyboard/select alternative. Archive with a reason (rejected, withdrawn, no response, expired, offer declined); restore | idea |
| F3 | Opportunity workspace | Detail view: job description, notes, key dates, interview rounds (date, type, notes), automatic activity timeline | idea |
| F4 | Needs attention | Dashboard of upcoming deadlines and interviews, and stale applications with in-app follow-up nudges | idea |
| F15 | Public site MVP | Polished landing page (what/who/why, how it works, feature highlights with honest "coming soon" labels), request-access form, sign-in call to action, privacy notice and terms, SEO basics (metadata, Open Graph, sitemap, robots), responsive, accessible, Lighthouse ≥98. Visual quality is an explicit acceptance concern. Requires N1 (name) before removing noindex | idea |

## Phase 1.5: Before inviting anyone else
| ID | Feature | Summary | Status |
|---|---|---|---|
| F5 | Invites, privacy and email sign-in | Approve access requests into the allowlist; email sign-in (one-time code preferred over a link; needs an owned domain and an email provider); account linking by verified email; data export (JSON); account deletion; per-user abuse limits, including **rate limiting backed by a shared store** (F0's Better Auth rate limit is in-memory per serverless instance; WORK-001 L-2); processor list | idea |

## Phase 2: AI copilot
| ID | Feature | Summary | Status |
|---|---|---|---|
| F6 | AI foundation and job description analysis | Provider integration behind an internal interface, per-user quotas, a global spend cap, a usage log. Structured job description summary: requirements, skills, seniority, red flags. Optional free "copy prompt" mode. Funding model decided here | idea |
| F7 | Interview prep pack | Likely questions by type, what each probes, answer guidance. Stored per opportunity; regeneration counts against quota | idea |
| F8 | Profile and CV | Upload or paste a CV; personalised prep and gap analysis | idea |
| F9 | Mock interview practice | User answers a question; AI gives feedback | idea |

## Phase 3: Breadth
| ID | Feature | Summary | Status |
|---|---|---|---|
| F10 | Email reminders | Deadlines, interviews and follow-ups via email (reuses F5's email provider) | idea |
| F11 | Coding/technical practice | AI-generated problems and feedback; no server-side code execution unless separately designed | idea |
| F12 | Offer comparison | Structured side-by-side comparison of offers | idea |
| F13 | Faster capture | Browser extension or URL import the user triggers (no background scraping) | idea |
| F14 | Search insights | Funnel conversion by stage and source, time in stage | idea |
| F16 | Public site expansion | FAQ, product tour/screenshots, changelog; pricing only if it becomes commercial (which triggers a hosting review under ADR-0001) | idea |

## Cross-cutting decisions pending
- N1 Product name and brand: required before F15 removes noindex.
- Commercial intent: any pricing, payments or ads takes the product outside Vercel Hobby's terms (ADR-0001).
- Error tracking/monitoring beyond Vercel's 1-hour logs: decide before F5 (inviting others).

## Parked (undecided whether ever)
- CV tailoring and cover-letter generation (depends on F8).
- Calendar or email-inbox integration (high-sensitivity OAuth scopes).
- Passkeys (revisit after F5 provides email as a recovery path).
- Native mobile app (responsive web is enough for now).
