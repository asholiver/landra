# Learning: Gate commands that resolve through package scripts can be weakened without touching gates.json
## Context
Project asholiver/landra, WORK-001 (F0 Foundation), gate checkpoint after task T1, 2026-10-05, ai-engineering plugin v0.2.0. The plugin protects gate integrity by reading `.agents/gates.json` from the committed HEAD (`run-gate.sh` / `lib.sh load_gates`) and, at review time, reading it from the base ref and flagging changes ("THIS CHANGE MODIFIES THE ... GATE"). T1 (platform agent) proposed `{"fast":"pnpm run check:fast","full":"pnpm run check:full"}`, delegating every step to package.json scripts.
## Observation
With single-indirection gate commands, a later change can edit or drop gate steps in package.json without touching gates.json, so the base-ref comparison does not flag it. This defeats the boundary that an agent must not define the checks for its own work.

Owner decision: list each step explicitly in gates.json (`pnpm lint && pnpm typecheck && pnpm test` ...; full adds test:integration, build, build:vercel, test:e2e, `pnpm audit --prod --audit-level high`), remove the `check:*` scripts, and treat future additions as explicit, reviewed gate changes.

Residual gap (explicitly acknowledged by the owner): each listed command (`pnpm test`, `pnpm lint`, ...) still resolves through package.json scripts and tool configs (vitest, biome, playwright), which the change under review can modify (e.g. `"test": "true"`, excluding test files, disabling lint rules). Explicit listing improves the boundary but does not close it.
## Cause
Gate integrity is enforced only on the text of gates.json. Anything the gate commands resolve to (package scripts, tool config) is outside the protected, base-ref-compared surface.
## Lesson
Treat package.json `scripts` and test/lint/build config as part of the gate definition. Do not accept a gate command that is a single indirection to a package script.
## Scope
General (proposed guardrail)

Proposed rule (for the ai-engineering-system repository, to be designed and decided there): during review, also diff gate-relevant files between the base ref and HEAD (package.json `scripts`, test/lint config files, and a project-declared list of "gate-defining files" in gates.json) and flag changes the same way gate-command changes are flagged. Optionally run gates using scripts and configs taken from the base ref. In setup/deliver, warn when a proposed gate command is a single indirection to a package script.
## Follow-up
- **AGENTS.md: not adopted** (owner decision, 2026-10-05). This is mainly a global gate-integrity problem and a candidate for the post-F0 ai-engineering-system review. The requirement still stands: changes capable of weakening certification (gate commands, package scripts, test/lint/build config) need appropriate review.
- code change (decided by owner, applied by the delivery coordinator in commit c7b2c87): gates.json lists steps explicitly; `check:*` scripts removed.
- ai-engineering-system improvements above: raise in that repository.
