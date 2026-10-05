/**
 * Structured JSON logger. Redacts sensitive keys and any email address found in values,
 * so tokens, cookies, secrets and full emails never reach the log stream.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export type Logger = {
  [level in LogLevel]: (message: string, fields?: Record<string, unknown>) => void;
};

const SENSITIVE_KEY_PATTERN =
  /token|cookie|authorization|secret|password|passwd|credential|api[-_]?key|set-cookie|session/i;
const EMAIL_PATTERN = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MAX_DEPTH = 6;

const PARAMS_PATTERN = /\bparams:[\s\S]*$/i;
const BEARER_PATTERN = /\bBearer\s+\S+/gi;
// Session tokens, signed cookie values, JWTs, hex/base64 secrets: long unbroken runs. "/" is not
// part of the class so URL paths and routes are judged one segment at a time and survive.
const TOKEN_LIKE_PATTERN = /[A-Za-z0-9_+=.-]{32,}/g;
// scheme://user:password@host: the credentials are dropped, the host (even without a TLD) kept.
const URL_USERINFO_PATTERN = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@"']+@/gi;
// Query strings and fragments: keys and structure kept, every value replaced.
const QUERY_OR_FRAGMENT_PATTERN = /([?#])([^\s"'#]*)/g;
// "cookie: x=y", "password=...", "accessToken: ...": the key stays, the value goes.
const SECRET_ASSIGNMENT_PATTERN =
  /((?:set-cookie|cookie|token|secret|password|authorization)[^=:\s]*\s*[=:]\s*)\S+/gi;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION_PATTERN =
  /^(?:dev|[0-9a-f]{7,12}|[0-9a-f]{40}|[0-9a-f]{64}|v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/i;
const URL_PATH_PATTERN = /^\/[A-Za-z0-9\-._~/:*]{0,200}$/;
const METHOD_PATTERN = /^[A-Z]{3,7}$/;
const LONGEST_SAFE_PATH_SEGMENT = 31;

/**
 * Structured keys whose string values are exempt from free-text token redaction (so request ids,
 * versions and routes stay useful), but only when the value has the expected shape. A value that
 * does not match its shape falls back to normal redaction.
 */
const SAFE_VALUE_SHAPES: Record<string, (value: string) => boolean> = {
  requestId: (value) => UUID_PATTERN.test(value),
  version: (value) => VERSION_PATTERN.test(value),
  method: (value) => METHOD_PATTERN.test(value),
  route: isSafePath,
  path: isSafePath,
};

function isSafePath(value: string): boolean {
  return (
    URL_PATH_PATTERN.test(value) &&
    value.split("/").every((segment) => segment.length <= LONGEST_SAFE_PATH_SEGMENT)
  );
}

export const REDACTED = "[redacted]";
export const REDACTED_TOKEN = "[redacted-token]";
export const REDACTED_EMAIL = "[redacted-email]";

/**
 * Redacts free text: DB driver errors append bound parameters after "params:" (which can hold
 * tokens and emails), so everything from there on is dropped; bearer values, emails and
 * token-like runs are replaced.
 */
export function redactText(text: string): string {
  return text
    .replace(PARAMS_PATTERN, "params: [redacted]")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(URL_USERINFO_PATTERN, "$1[redacted]@")
    .replace(QUERY_OR_FRAGMENT_PATTERN, (_match, marker: string, rest: string) => {
      return `${marker}${rest.replace(/([^&=]+)=([^&]*)/g, "$1=[redacted]")}`;
    })
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1[redacted]")
    .replace(EMAIL_PATTERN, REDACTED_EMAIL)
    .replace(TOKEN_LIKE_PATTERN, REDACTED_TOKEN);
}

export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message, depth + 1) };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = REDACTED;
    } else if (
      typeof item === "string" &&
      Object.hasOwn(SAFE_VALUE_SHAPES, key) &&
      SAFE_VALUE_SHAPES[key]?.(item)
    ) {
      output[key] = item;
    } else {
      output[key] = redact(item, depth + 1);
    }
  }
  return output;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(
  options: { minimumLevel?: LogLevel; write?: (line: string) => void } = {},
): Logger {
  const minimumLevel = options.minimumLevel ?? "info";
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const emit = (level: LogLevel, message: string, fields: Record<string, unknown> = {}) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel]) return;
    const entry = {
      ...(redact(fields) as Record<string, unknown>),
      level,
      time: new Date().toISOString(),
      message: redactText(message),
    };
    write(JSON.stringify(entry));
  };
  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
  };
}
