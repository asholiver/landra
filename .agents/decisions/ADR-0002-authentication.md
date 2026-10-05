# ADR-0002: Better Auth in our own Postgres, Google sign-in first, allowlist-gated
## Status
Accepted (Ashley Oliver, 2026-10-05)
## Context
- The owner uses the product first. Invited testers come later; there is no public sign-up.
- Future users may not be developers.
- Hand-rolled auth and passwords are out of scope (breach and recovery risk).
- The constraint of near-£0 cost and no paid auth vendor.
- The MVP uses a free platform subdomain (no owned domain).

Facts verified 2026-10-05:
- Better Auth magic link tokens are single-use with a 5-minute default expiry. `disableSignUp` restricts sign-in to existing users.
- Better Auth's OAuth Proxy plugin lets preview deployments with dynamic URLs reuse the production OAuth callback.
- Resend's free tier requires a verified owned domain to email anyone but the account owner.
## Decision
- Library: Better Auth. Users, sessions and accounts are stored in our Postgres via the Drizzle adapter (ADR-0003).
- F0: Google OAuth is the only sign-in method. Scopes: `openid email profile`.
- Account creation is gated by a server-side allowlist of email addresses. A user-creation hook rejects any email not on the list. Allowlist entries are managed by an owner-run script; personal emails are never committed to the repository.
- Preview deployments sign in through the OAuth Proxy plugin. The proxy secret is a deployment secret: it's never exposed to fork PRs and never committed.
- F5 (Invites, privacy and email sign-in) adds email sign-in, preferring a one-time code over a clickable link because email scanners pre-open links. A domain is bought at that point for sending. Accounts link by verified email.
- Not planned: GitHub sign-in (developer-centric), passwords, Apple (needs a paid developer account). Passkeys are parked until email sign-in exists as a recovery path.
## Why
- Google costs nothing, is familiar to most job seekers, and delegates MFA and recovery to Google.
- Better Auth keeps identity data in our database: no extra processor, no per-user vendor cost, portable.
- The allowlist enforces the invite-only decision at the trust boundary rather than in the UI.
## Alternatives considered
### Clerk (managed)
Fastest setup and a hosted UI. Rejected: identity data held by a third party (an extra GDPR processor) and vendor lock-in.
### Magic link in F0
Rejected for now: it needs an owned sending domain and an email provider, which isn't justified while the owner is the only user.
### GitHub OAuth
Rejected as a primary option: it doesn't suit non-developer users.
## Consequences
- Anyone without a Google account can't sign in until F5. That's acceptable while the product is owner-only.
- A Google Cloud OAuth client and consent screen must be configured by the owner (a human prerequisite).
- Preview sign-in depends on the OAuth Proxy plugin and a shared secret.
- Negative tests must prove non-allowlisted accounts are refused.
