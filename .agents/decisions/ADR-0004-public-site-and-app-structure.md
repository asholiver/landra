# ADR-0004: Public site and application in one deployable; not indexed until named
## Status
Accepted (Ashley Oliver, 2026-10-05)
## Context
- The product needs a polished, public, signed-out experience that explains what it is, who it's for and why it's useful, with sign-in and request-access calls to action.
- The authenticated app sits behind it.
- The product name is undecided; "landra" is only the repository's working name.
- Deployments may be publicly reachable for demos, but shouldn't be discoverable until the name and proper public site exist.
## Decision
- One codebase and one deployment (ADR-0001), with two route areas:
  - Public: pre-rendered, minimal client JS, SEO metadata, Lighthouse ≥98.
  - App: authenticated, under `/app`, never indexed.
- Both share a single design system (tokens and components).
- The product name is a single configuration constant holding a neutral placeholder. The repository name is never used as the product name in UI copy.
- Until the naming decision and F15 (public site MVP) are complete:
  - every response carries `X-Robots-Tag: noindex, nofollow`;
  - pages include a robots `noindex` meta tag;
  - `robots.txt` doesn't block crawling, because blocked crawlers would never see the noindex.
- F0 ships only a simple placeholder public page and a sign-in page. The polished public site is F15, where visual quality is an explicit acceptance concern.
## Why
- A single deployable avoids two pipelines, keeps sessions same-origin, and shares the design system.
- Noindex-but-reachable allows demos without pre-empting the name or the launch.
## Alternatives considered
### Separate static marketing site (e.g. Astro) plus the app
Best-in-class static output. Rejected: two codebases, two deploy pipelines and a split design system.
### Password-protect the whole deployment
Rejected: it blocks demos, and Vercel password protection is a paid add-on.
## Consequences
- Removing noindex is an explicit launch step tied to naming and F15.
- Public routes must stay free of heavy client JS to meet Lighthouse ≥98.
