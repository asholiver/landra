export const DEFAULT_RETURN_PATH = "/app";

const PLACEHOLDER_ORIGIN = "http://return-path.invalid";
const MAX_LENGTH = 2048;
const MAX_DECODE_ROUNDS = 3;
// Control characters, whitespace and backslashes are never legitimate in a raw return path and
// are interpreted inconsistently by browsers (for example `/\evil.example`).
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const FORBIDDEN_RAW_CHARACTERS = /[\u0000-\u0020\u007f\\]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const FORBIDDEN_DECODED_CHARACTERS = /[\u0000-\u001f\u007f\\]/;

function decodeOnce(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Inspects a path and every percent-decoded form of it (an attacker may encode `//` or `\`).
 * Decoded forms may legitimately contain spaces (`%20`), so only the raw value forbids those.
 */
function isSafeEncodedPath(path: string): boolean {
  let current = path;
  for (let round = 0; ; round += 1) {
    if (FORBIDDEN_DECODED_CHARACTERS.test(current)) return false;
    if (!current.startsWith("/") || current.startsWith("//")) return false;
    const decoded = decodeOnce(current);
    if (decoded === null || decoded === current) return true; // fully decoded (or a literal `%`)
    if (round >= MAX_DECODE_ROUNDS) return false; // still encoded after several rounds
    current = decoded;
  }
}

/**
 * Returns `candidate` only if it is a same-origin relative path (`/something`), otherwise
 * `fallback`. Rejects absolute URLs, protocol-relative URLs (`//host`), backslash tricks and
 * their percent-encoded (including repeatedly encoded) variants.
 */
export function sanitiseReturnPath(
  candidate: string | null | undefined,
  fallback: string = DEFAULT_RETURN_PATH,
): string {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > MAX_LENGTH) {
    return fallback;
  }

  if (FORBIDDEN_RAW_CHARACTERS.test(candidate)) return fallback;
  if (!isSafeEncodedPath(candidate)) return fallback;

  let parsed: URL;
  try {
    parsed = new URL(candidate, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (parsed.origin !== PLACEHOLDER_ORIGIN) return fallback;

  // Dot segments normalise away (`/.//evil.example` becomes `//evil.example`), so the final
  // output is validated again, exactly as a browser will resolve it.
  const normalised = `${parsed.pathname}${parsed.search}`;
  if (!normalised.startsWith("/") || normalised.startsWith("//") || normalised.startsWith("/\\")) {
    return fallback;
  }
  // Encoded separators can survive normalisation (`/%2e/%2fevil.example` becomes
  // `/%2fevil.example`, which decodes to `//evil.example`), so decode-check the output too.
  if (!isSafeEncodedPath(normalised)) return fallback;
  try {
    if (new URL(normalised, PLACEHOLDER_ORIGIN).origin !== PLACEHOLDER_ORIGIN) return fallback;
  } catch {
    return fallback;
  }
  return normalised;
}
