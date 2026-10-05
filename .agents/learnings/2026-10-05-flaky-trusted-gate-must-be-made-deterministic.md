# Learning: A failed trusted gate must be diagnosed and made deterministic, never rerun until green
## Context
WORK-001, T3 (2026-10-05, ai-engineering plugin v0.2.0). The owner-approved full gate passed in a clean environment before commit (exit 0: 197 unit, 42 integration, 36 E2E, Lighthouse, audit). After committing T3 (b171109), the committed full gate via run-gate.sh FAILED twice in a row on one E2E test: `tests/e2e/smoke.spec.ts` "shows the loading state while the sign-in request is in flight" (5000ms timeout waiting on a poll predicate).
## Observation
- A pre-commit pass does not prove determinism.
- The failure was a test defect, not a product defect.
- The coordinator first hypothesised a race with the deferred `public/sign-in.js` (a click landing before the submit handler attached). **Repeat runs disproved that as the main cause.** Adding a readiness wait left the failure rate about the same: 4 failures in 220 runs, then 2 in 20.
- The confirmed cause: the test read page state with `page.evaluate` while the click's navigation (to a route the test deliberately holds open) was pending. Playwright evaluation intermittently hangs during a pending navigation. Moving the evaluate into the route handler failed 40 times out of 40, which confirmed it.
- Owner directive: a failed trusted gate caused by suspected flakiness must be investigated and made deterministic, not rerun until green.
## Cause
The test observed the page through a mechanism (`page.evaluate`) that isn't reliable while a navigation is pending. It also had no explicit readiness signal for the deferred, progressively-enhanced script, which was a secondary race.
## Lesson
1. A gate failure is evidence. Never rerun a trusted gate hoping for green.
2. Tests that interact with deferred or progressively-enhanced scripts need an explicit readiness signal, not timing. `sign-in.js` now sets `data-enhanced="true"` after attaching handlers, and the test waits for it.
3. Don't query the page (`page.evaluate`, locators) while a navigation is deliberately held pending. Capture the state in the page itself (an `addInitScript` submit listener that reports through `exposeFunction`). The assertion was not weakened.
4. Verify a hypothesis before acting on it. The first plausible cause was wrong, and only repeat runs exposed that. Show stability with repeat runs (`--repeat-each`; here 40× gave 440 passes and 0 flaky) plus the full suite.
5. Report the failure honestly, with the investigation and the cause, including corrections to earlier hypotheses.
## Scope
General (proposed guardrail), and also a project rule.

**Durable requirement** (owner, 2026-10-05): a failed trusted gate must stay visible. Rerunning until green must not turn it into evidence of success.

Strong candidate for a global engineering-system principle: "Never rerun a failed quality gate hoping it passes; investigate, make it deterministic, record the cause."

**Possible solution, not an approved design:** `run-gate.sh` could record consecutive results so reruns become visible. How to enforce the requirement is decided in the post-F0 review.
## Follow-up
- **AGENTS.md: not adopted** (owner decision, 2026-10-05). Learnings aren't promoted to project rules automatically. This is a candidate for the post-F0 ai-engineering-system review.
- **Code change:** the observation fix and the readiness marker, committed separately from the T3 commit b171109.
- **Regression test:** the E2E loading-state test itself, with state captured in-page and a `data-enhanced` wait. Keep it.
- ai-engineering-system candidate: add the "do not rerun a failed gate without a diagnosed cause and change" wording to deliver/review guidance.
