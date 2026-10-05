# Planning Session: WORK-001 Product direction, roadmap and F0 Foundation

## Objective
1. Agree the overall product direction and a feature roadmap (`.agents/project/roadmap.md`).
2. Agree the architecture, tech stack and hosting that all features build on.
3. Specify F0 Foundation (`.agents/specs/active/WORK-001.md`).

Out of scope: building product features. Each roadmap feature gets its own planning session and spec.

## Facts
- Greenfield repository, public on GitHub (`asholiver/landra`). (2026-10-05)
- Product name not chosen. "landra" is the repository's working name only.
- Claude Pro and ChatGPT Plus are consumer subscriptions with no API access.
- Vercel Hobby, Neon Free, Cloud Run, Resend and Better Auth facts verified 2026-10-05: see ADR-0001 to ADR-0003.
- Vercel Hobby allows a single function region; the default is `iad1`, and it's configurable to `lhr1` via `vercel.json`.
- Local machine: Node 22.20.0, pnpm and Docker installed.

## Decisions
- DECIDED D1 Audience: owner first; later, invite-only testers. No public sign-up. (User, 2026-10-05)
- DECIDED D2 Stack preferences: TypeScript, React, react-hook-form, Biome, Node.js, PostgreSQL. (User, 2026-10-05)
- DECIDED D3 Responsive web only. (User, 2026-10-05)
- DECIDED D4 Feature-by-feature delivery against a living roadmap. WORK-001 = direction + F0 only. (User, 2026-10-05)
- DECIDED D5 MVP success: deployed at a free public URL at around £0, with basic tracking, demoable from anywhere. (User, 2026-10-05)
- DECIDED D6 CV/profile wanted but not critical: F8. (User, 2026-10-05)
- DECIDED D7 AI is not in the MVP; it's Phase 2. (User, 2026-10-05)
- DECIDED D8 Better Auth in our own Postgres → ADR-0002. (User, 2026-10-05)
- DECIDED D9 Free platform subdomain for the MVP. (User, 2026-10-05)
- DECIDED D10 Polished public site with the app behind it → ADR-0004; roadmap F15. Visual quality is an acceptance concern in F15. (User, 2026-10-05)
- DECIDED D11 Product name stays undecided until explicitly agreed; the repository name is internal only. (User, 2026-10-05)
- DECIDED D12 React Router v7 on Vercel Hobby + Neon London, with portability guardrails and a Node build proven in CI → ADR-0001. (User, 2026-10-05)
- DECIDED D13 Google-only sign-in for F0; email sign-in in F5 (pre-invite) → ADR-0002. (User, 2026-10-05)
- DECIDED D14 Drizzle with reviewed SQL migrations → ADR-0003. (User, 2026-10-05)
- DECIDED D15 Automated backups are delivered in F1, not F0, and must be in place before real opportunity data is relied on. (User, 2026-10-05)
- DECIDED D16 F0 has only a simple placeholder public page. Deployments are publicly reachable but noindex until naming and F15 → ADR-0004. (User, 2026-10-05)
- DECIDED D17 Feature IDs are permanent and never renumbered or reused. Fixed a drift where IDs had been shifted after inserting the public site: original IDs F0–F14 restored, public site = F15, public site expansion = F16. (User, 2026-10-05)

- DECIDED D18 WORK-001 approved by Ashley Oliver on 2026-10-05:
  - production deploys need manual approval in a GitHub `production` environment;
  - Node 24 if supported, else 22, pinned everywhere;
  - working label "Job Search Copilot";
  - local-first delivery with staged external-service boundaries;
  - planning state committed on a work branch before implementation.

- DECIDED D19 Learnings aren't promoted to AGENTS.md automatically. The path is: project incident/failure → project learning → candidate global improvement → post-F0 ai-engineering-system review → deliberate promotion to a rule, automation, test or workflow if warranted. None of the four AGENTS.md lines proposed during WORK-001 was adopted. The installed plugin isn't modified from this project. (User, 2026-10-05)

## Open questions
- OPEN N1 Product name and brand: before F15 removes noindex.
- OPEN Q9 AI funding model: decided in F6 planning.
- OPEN Error tracking beyond Vercel's 1-hour logs: before F5.
- F0-specific assumptions and open items are listed in WORK-001.md (Open decisions).

## Specialist input
Captured in ADR-0001 to ADR-0004 and the Security, Scalability and Testing sections of WORK-001.md.

## Cross-work dependencies
- F0 sets auth, data-access conventions, route structure and deployment for all later features.
- F1 owns backups (D15). F15 depends on N1. F5 depends on buying a domain and choosing an email provider.

## Result
Direction, roadmap and ADR-0001 to ADR-0004 recorded. WORK-001 (F0) spec approved (2026-10-05).
