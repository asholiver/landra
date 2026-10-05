/**
 * CSRF defence for the state-changing routes this app owns (sign-in start and sign-out).
 * Better Auth's own origin check only runs for requests that arrive through its HTTP handler;
 * these routes call the server API directly, so they check the Origin header themselves.
 *
 * A browser always sends `Origin` on a cross-site or same-site POST. A request without one is
 * refused: it cannot be a legitimate form post from this site.
 */
export function isTrustedOrigin(headers: Headers, trustedOrigins: readonly string[]): boolean {
  const origin = headers.get("origin");
  if (origin === null) return false;
  return trustedOrigins.includes(origin);
}
