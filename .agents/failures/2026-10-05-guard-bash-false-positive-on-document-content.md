# Learning: guard-bash.sh false positives: keywords in data rather than executed operations
Two categories, same guard (plugin `scripts/guard-bash.sh`, ai-engineering v0.2.0, PreToolUse Bash), three instances:
1. Keywords inside heredoc/document/source data being written (instances 1 and 3).
2. Dangerous-operation keywords used as arguments to read-only inspection/search commands (instance 2).
## Context
### Category 1: document content in a heredoc
2026-10-05, repo asholiver/landra, WORK-001 planning (approving the F0 spec). The assistant ran `python3 - <<'EOF' ... EOF` whose body only did string replacements in `.agents/specs/active/WORK-001.md`. The replacement prose contained "pnpm audit", "vercel deploy --prebuilt", "production deploy", "release" and "/healthz". The PreToolUse Bash hook returned `permissionDecision: "ask"` as a high-impact operation. The user rejected the prompt and identified it as a false positive. No deploy, release, publish, push or merge was occurring.
### Category 2: dangerous keyword as a search argument
2026-10-05, WORK-001 T2 verification. The coordinator ran one Bash command combining: activate Node, run the fast gate via `run-gate.sh`, `git status --short`, and `grep -rn "DROP\|TRUNCATE" --include=*.ts src app scripts tests` (to locate potentially destructive SQL in source). The guard's "SQL TRUNCATE / truncate" rule (`(^|[^[:alnum:]_-])truncate([^[:alnum:]_-]|$)`, case-insensitive) matched the word inside the grep pattern and asked for approval of a destructive operation. No TRUNCATE was executed; it was an argument to a read-only search. (The "SQL DROP" rule requires DROP followed by TABLE/DATABASE/etc., so DROP alone did not match.) The owner denied it as a false positive.
Side effect: the inspection was bundled with the gate run, so a harmless inspection false positive prevented the quality gate from running. Remediation: the gate was rerun alone (`GATE fast: PASSED`) and source inspection was done with the Read tool instead of grep.
### Instance 3 (category 1): application source code written via shell text transformation
2026-10-05, WORK-001 T2 security-remediation round 3, backend implementation agent. The agent edited a TypeScript source file with a shell-based text transformation whose command text contained new source code and comments: a comment (requested finding L-2 documentation) saying the in-memory rate limit is per-instance on "serverless" platforms, plus allowlist revocation code/comments containing "remove"/"Removal". The guard rule `(serverless|sls|sam)<ws>(.*<ws>)?(deploy|remove|delete)` (word-bounded, case-insensitive, over the whole command text) matched "serverless ... remove" across the source text and asked approval for "serverless deploy/remove". No infrastructure operation was being executed. The owner denied it as a false positive.
Remediation: the agent was instructed to make all file edits with Edit/Write (not routed through the Bash guard) and never shell text transformations. The guard was not modified.
Significance: same root cause as instance 1, but with source code rather than documents. It shows the tool name and keyword need not be adjacent or in the same sentence, since `(.*<ws>)?` allows arbitrary distance.
Process lesson: this agent had already been told to use Edit/Write for files and still used a shell edit. Agent instructions alone are a weak control.
## Observation
The guard classifies intent by regex over the whole command text (newlines/tabs collapsed to spaces), including heredoc bodies, string literals and arguments. Likely matches:
- Category 1: the deploy/release task rule `(npm|pnpm|yarn|bun)<ws>(.*<ws>)?[^ ]*(deploy|release|publish|destroy|teardown)[^ ]*`, since "pnpm" and "deploy" both appear anywhere in the text; possibly the deploy/release script path rule.
- Category 2: the SQL TRUNCATE rule matching a bare word anywhere in the text, regardless of which program is executed.
- Instance 3: the serverless/sls/sam rule `(serverless|sls|sam)<ws>(.*<ws>)?(deploy|remove|delete)`, matching "serverless" and "remove" arbitrarily far apart inside written source text. Ordinary words in comments and code ("remove", "delete", "deploy") are common, so any prose mentioning these platforms is at risk.

The script itself states that it "errs towards asking" and "only sees the command text". These false positives are a known limitation, not a malfunction.
## Cause
Matching does not distinguish executed command tokens from data (heredoc bodies, quoted strings, search patterns), and tool and keyword need not belong to the same simple command. The executed program (search/read-only tool vs SQL client or deploy tool) is not considered.
## Impact
- Misleading high-impact approval prompts on harmless doc edits and read-only searches.
- Approval-fatigue risk: users learn to click through guard prompts, which undermines the guard.
- Legitimate doc edits and code inspection via shell are blocked or slowed.
- Bundled commands: one false positive blocks every other step in the same command, including quality gates.
## Lesson
- Edit documents with the Edit/Write tools, not shell heredocs. The Bash guard is not meant to govern file edits.
- Prefer non-shell tools (Grep/Read/Glob) for inspection and search, especially for destructive keywords (DROP, TRUNCATE, deploy, etc.).
- Keep quality-gate runs in their own single-purpose command so an unrelated guard prompt cannot block or be bundled with the gate.
- Keep commit messages and shell commands free of prose that resembles deploy/release/destructive commands.
- Never route around the guard for a real high-impact command.
- Source code is data too: write and edit it with Edit/Write, never `sed`/`python -c`/heredoc text transformations. Because instructions alone proved weak (instance 3), upstream should consider reinforcing this with implementation-agent guidance and a hook nudge discouraging shell-based file writes.
## Scope
General (proposed guardrail)

Proposed rule (for a human to raise in the ai-engineering-system repository; not to be changed from this project): the Bash guard should match on executed command structure, not raw text. Strip heredoc bodies and quoted string literals before matching where the executed program is not an interpreter of that text, and anchor tool+subcommand matching within a single simple command (split on `;`, `&&`, `||`, `|`, newlines) instead of "tool ... anywhere later ... keyword". Classify by the executed program: search/read-only tools (grep, rg, git grep, `git log -S`, find -name, etc.) should not trigger destructive-keyword rules from their arguments, whereas SQL clients and similar (`psql -c "TRUNCATE t"`) must still ask. Do not simply ignore all quoted text, because a truly destructive keyword can hide in an argument. Indirection such as `bash -c 'npm publish'` remains legitimately ambiguous and should still ask.
## Follow-up
- Upstream regression tests to propose in ai-engineering-system:
  - Category 1:
    - heredoc containing deploy prose must not ask;
    - `pnpm run deploy` must still ask;
    - `python3 -c "..."` containing 'npm publish' text must not ask;
    - `bash -c 'npm publish'` must still ask.
  - Category 2:
    - `grep -rn "DROP DATABASE\|TRUNCATE" src` must not ask;
    - `rg -n 'terraform apply' docs/` must not ask;
    - `git log -S 'TRUNCATE'` must not ask;
    - `psql -c "TRUNCATE t"` must still ask;
    - `echo "TRUNCATE t" | psql` should still ask.
  - Instance 3 (serverless/sls/sam rule):
    - a heredoc, `python -c` or `sed` writing source text "runs on serverless; remove the entry" must not ask;
    - `serverless remove --stage prod` must ask;
    - `npx serverless remove` must ask;
    - `sls remove` must ask;
    - `sam delete --stack-name x` must ask;
    - prose such as "same ... delete" must not match `sam` (verify the word boundary already prevents this).
- Upstream consideration: nudge or hook against shell-based file writes by implementation agents, since prompt instructions alone did not prevent it.
- **AGENTS.md: not adopted** (owner decision, 2026-10-05). Using Edit/Write instead of shell is a tool-specific workaround for current guard and agent behaviour, not a project engineering rule. The evidence is kept here for the post-F0 ai-engineering-system review.
- No code change in this project; the installed guard is not to be modified from here.
