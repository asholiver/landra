import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// `pnpm scan:secrets` (AC13): scans the FULL git history for committed secrets with gitleaks.
// CI runs this same script, so there is one pinned definition. The scanner is the official image,
// pinned to an immutable digest: the multi-arch index of tag v8.30.1 (linux/amd64 and linux/arm64).
// The repository is mounted read-only; findings are redacted in the output.
// Requires Docker. No global install. To upgrade, change the tag and digest together.
const GITLEAKS_IMAGE =
  "ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f";

const root = resolve(import.meta.dirname, "..");

const result = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--volume",
    `${root}:/repo:ro`,
    // On Linux (CI) the mounted checkout is owned by another user than the container's, and git
    // refuses such a repository ("dubious ownership"). Trust exactly this mount, via environment
    // configuration, so nothing is written to any git config file.
    "--env",
    "GIT_CONFIG_COUNT=1",
    "--env",
    "GIT_CONFIG_KEY_0=safe.directory",
    "--env",
    "GIT_CONFIG_VALUE_0=/repo",
    GITLEAKS_IMAGE,
    "git",
    "/repo",
    "--redact",
    "--no-banner",
    "--exit-code",
    "1",
  ],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`Could not run Docker (is it installed and running?): ${result.error.message}`);
  process.exit(2);
}
process.exit(result.status ?? 2);
