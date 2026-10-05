/** Build version from the environment (git SHA), or "dev" locally. */
export function resolveVersion(env: Record<string, string | undefined>): string {
  return env.GIT_SHA?.trim() || env.VERCEL_GIT_COMMIT_SHA?.trim() || "dev";
}

/** Liveness payload: no database or network access, so it never wakes Neon (R7). */
export function healthPayload(version: string) {
  return { status: "ok", version } as const;
}
