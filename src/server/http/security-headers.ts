/**
 * The single definition of the response security headers (R9, R10).
 *
 * Deliberately self-contained (no imports): it is used by every serving path.
 *  - Dynamic responses, through the request policy (src/server/http/request-policy.ts).
 *  - The standalone Node server, for the static files it serves itself (server/node-server.ts,
 *    loaded directly by Node, so this file must stay erasable TypeScript with no imports).
 *  - Vercel, where the same headers are declared in vercel.json for statically served paths; a
 *    unit test keeps vercel.json identical to `securityHeaders()`.
 */

export const ROBOTS_HEADER_VALUE = "noindex, nofollow";

const PERMISSIONS_POLICY = [
  "accelerometer",
  "camera",
  "display-capture",
  "geolocation",
  "gyroscope",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "usb",
]
  .map((feature) => `${feature}=()`)
  .join(", ");

export type SecurityHeaderOptions = {
  /**
   * Per-response nonce for inline scripts. Only dynamic HTML responses have one; prerendered
   * pages ship no inline scripts, so their policy needs none.
   */
  nonce?: string;
  /**
   * Omit the Content-Security-Policy header. Used only by the Vite dev server, whose HMR
   * client needs inline scripts; every production build sends the policy.
   */
  omitContentSecurityPolicy?: boolean;
};

/** CSP with no `unsafe-inline` for scripts (R10). Inline scripts need the response's nonce. */
export function buildContentSecurityPolicy(options: { nonce?: string } = {}): string {
  const scriptSources = ["'self'"];
  if (options.nonce) scriptSources.push(`'nonce-${options.nonce}'`);
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", scriptSources],
    ["style-src", ["'self'"]],
    // Google profile pictures are the only third-party images.
    ["img-src", ["'self'", "data:", "https://*.googleusercontent.com"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    // Chrome applies form-action to redirects after a submission, and sign-in redirects to Google.
    ["form-action", ["'self'", "https://accounts.google.com"]],
    ["frame-ancestors", ["'none'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
}

/** Headers for every response. `X-Request-Id` is added separately to dynamic responses only. */
export function securityHeaders(options: SecurityHeaderOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Robots-Tag": ROBOTS_HEADER_VALUE,
    "Strict-Transport-Security": "max-age=63072000",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": PERMISSIONS_POLICY,
  };
  if (!options.omitContentSecurityPolicy) {
    headers["Content-Security-Policy"] = buildContentSecurityPolicy({ nonce: options.nonce });
  }
  return headers;
}

/** Sets the security headers on `headers`, replacing any value already present. */
export function applySecurityHeaders(headers: Headers, options: SecurityHeaderOptions = {}): void {
  for (const [name, value] of Object.entries(securityHeaders(options))) {
    headers.set(name, value);
  }
}
