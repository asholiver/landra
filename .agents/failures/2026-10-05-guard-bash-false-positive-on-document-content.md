# Learning: guard-bash.sh false positive on document content in a heredoc
## Context
2026-10-05, repo asholiver/landra, WORK-001 planning (approving the F0 spec). The assistant ran `python3 - <<'EOF' ... EOF` whose body only did string replacements in `.agents/specs/active/WORK-001.md`. The replacement prose contained "pnpm audit", "vercel deploy --prebuilt", "production deploy", "release" and "/healthz". The PreToolUse Bash hook (plugin `scripts/guard-bash.sh`, ai-engineering v0.2.0) returned `permissionDecision: "ask"` as a high-impact operation. The user rejected the prompt and identified it as a false positive. No deploy, release, publish, push or merge was occurring.
## Observation
The guard classifies intent by regex over the whole command text (newlines/tabs collapsed to spaces), including heredoc bodies and string literals. Likely matches:
- the deploy/release task rule `(npm|pnpm|yarn|bun)<ws>(.*<ws>)?[^ ]*(deploy|release|publish|destroy|teardown)[^ ]*`, since "pnpm" and "deploy" both appear anywhere in the text;
- possibly the deploy/release script path rule.

The script itself states that it "errs towards asking" and "only sees the command text". The false positive is therefore a known limitation, not a malfunction.
## Cause
Matching does not distinguish executed command tokens from data (heredoc bodies, quoted strings), and tool and keyword need not belong to the same simple command.
## Impact
- Misleading high-impact approval prompt on a harmless doc edit.
- Approval-fatigue risk: users learn to click through guard prompts, which undermines the guard.
- Legitimate doc edits via shell are blocked or slowed.
## Lesson
Workaround used (not a bypass): edit documents with the Edit/Write tools, not shell heredocs. The Bash guard is not meant to govern file edits. Keep commit messages and shell commands free of document prose that resembles deploy/release commands. Never route around the guard for a real high-impact command.
## Scope
General (proposed guardrail)

Proposed rule (for a human to raise in the ai-engineering-system repository; not to be changed from this project): the Bash guard should match on executed command structure, not raw text. Strip heredoc bodies and quoted string literals before matching, and anchor tool+subcommand matching within a single simple command (split on `;`, `&&`, `||`, `|`, newlines) instead of "tool ... anywhere later ... keyword". Indirection such as `bash -c 'npm publish'` remains legitimately ambiguous and should still ask.
## Follow-up
- Upstream regression tests to propose in ai-engineering-system:
  - heredoc containing deploy prose must not ask;
  - `pnpm run deploy` must still ask;
  - `python3 -c "..."` containing 'npm publish' text must not ask;
  - `bash -c 'npm publish'` must still ask.
- Project rule (proposed wording for AGENTS.md, human to apply): "Edit documents with the Edit/Write tools, not shell heredocs; never route around the Bash guard."
- No code change in this project.
