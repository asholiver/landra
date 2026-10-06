# Learning: Destructive operations in test infrastructure need narrow approval and layered safeguards
## Context
2026-10-05, project asholiver/landra, WORK-001 task T2 (backend agent, ai-engineering:backend) building integration-test isolation. The agent issued one large compound Bash command combining many unrelated source/config file writes with a destructive SQL operation (recreate a dedicated integration-test database: DROP DATABASE + CREATE, guarded only by a check that the name ends in `_test`). The PreToolUse Bash guard (`guard-bash.sh`, "SQL DROP" rule) correctly flagged it and asked for approval. The owner denied it. The coordinator told the agent to stop destructive operations, never mix file edits with DB operations in one command, use Edit/Write for files and continue non-destructive work, and is redesigning isolation with explicit safeguards for owner approval.

Related, but different: `.agents/failures/2026-10-05-guard-bash-false-positive-on-document-content.md` was a false positive on harmless text. This one was a correct detection with an over-broad approval scope.
## Observation
- The denial was not because test-database recreation is wrong. The prompt bundled the destructive capability with unrelated file writes, so a human could not approve the destructive part independently.
- Owner's assessment: destructive operations in test infrastructure are legitimate. A `_test` name check is useful but insufficient alone. An accidentally supplied `TEST_DATABASE_URL` must not be able to target dev or production. Defence in depth is required.
- Once destructive SQL lives inside test code run by `pnpm test:integration`, the Bash guard no longer sees it.
## Cause
Compound command mixing unrelated intents, plus reliance on a single naming-convention check as the only target safeguard.
## Lesson
1. Keep shell commands single-purpose. Never bundle destructive operations with unrelated changes. Write files with Edit/Write.
2. Destructive test-infrastructure operations need layered target verification, not a naming convention alone: loopback host and port allowlist; refuse when the URL equals any app/dev/prod URL; a server-side disposable marker on the database; run-generated database names only.
3. Because runtime execution inside tests bypasses the Bash guard, review and explicit human approval of that code and its safeguards is the control.
## Scope
General (proposed guardrail)

Proposed rule (for a human to raise in the ai-engineering-system repository; not to be changed from this project): implementation agents must issue single-purpose shell commands, with files changed via Edit/Write, so destructive intents are approved alone. Destructive test-infrastructure code must implement layered target safeguards (above). Review must flag new destructive SQL in test setup code for explicit human approval, since its runtime execution bypasses the Bash guard.
## Follow-up
- Candidate upstream improvements (ai-engineering-system repo): guard asks with a message recommending the agent resubmit the destructive part separately, or denies compound commands mixing file writes and destructive intents; implementation-agent standard "single-purpose shell commands; files via Edit/Write"; a checklist of destructive test-infrastructure safeguards; a review check for new destructive SQL in test setup.
- **AGENTS.md: not adopted** (owner decision, 2026-10-05). The proposed line mixed a potentially reusable safety principle with WORK-001-specific detail. The approved disposable-database safeguards stay in their existing records (WORK-001 spec, ADR-0003, README). The general principle, narrow approval for destructive capabilities, is a candidate for the post-F0 ai-engineering-system review.
- Code change: WORK-001 isolation redesign with the safeguards above, pending owner approval. A negative test should show a non-disposable or app-equal URL is refused.
