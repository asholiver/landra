import type { Logger } from "../logging/logger";
import { applySecurityHeaders } from "./security-headers";

/** Per-request values the renderer needs: the CSP nonce, and the id echoed in `X-Request-Id`. */
export type RequestScope = { requestId: string; nonce: string };

export type RequestPolicyOptions = {
  logger: Logger;
  /** False only for the Vite dev server (see SecurityHeaderOptions). */
  sendContentSecurityPolicy: boolean;
  now?: () => number;
  createRequestId?: () => string;
  createNonce?: () => string;
};

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Wraps a dynamic request handler (R9, R10, R11):
 *  - gives the request a fresh id and CSP nonce (never taken from the incoming request);
 *  - applies the security headers and `X-Request-Id` to whatever response comes back;
 *  - writes one structured log line: request id, method, route (path only, never the query
 *    string, which can carry OAuth codes), status and duration.
 */
export async function runWithRequestPolicy(
  request: Request,
  handle: (scope: RequestScope) => Promise<Response>,
  options: RequestPolicyOptions,
): Promise<Response> {
  const now = options.now ?? (() => performance.now());
  const scope: RequestScope = {
    requestId: (options.createRequestId ?? (() => crypto.randomUUID()))(),
    nonce: (options.createNonce ?? randomNonce)(),
  };
  const started = now();
  const route = new URL(request.url).pathname;
  const logFields = (status: number) => ({
    requestId: scope.requestId,
    method: request.method,
    route,
    status,
    durationMs: Math.round(now() - started),
  });

  let response: Response;
  try {
    response = await handle(scope);
  } catch (error) {
    options.logger.error("request failed", {
      ...logFields(500),
      error: error instanceof Error ? error : new Error("unknown error"),
    });
    throw error;
  }

  const decorated = withHeaders(response, (headers) => {
    applySecurityHeaders(headers, {
      nonce: scope.nonce,
      omitContentSecurityPolicy: !options.sendContentSecurityPolicy,
    });
    headers.set("X-Request-Id", scope.requestId);
  });
  options.logger.info("request", logFields(decorated.status));
  return decorated;
}

/** Sets headers in place, or on a copy when the response's headers are immutable. */
function withHeaders(response: Response, change: (headers: Headers) => void): Response {
  try {
    change(response.headers);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    change(headers);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
