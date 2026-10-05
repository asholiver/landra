import { createContext, type MiddlewareFunction } from "react-router";
import { type RequestScope, runWithRequestPolicy } from "../../src/server/http/request-policy";
import { logger } from "../../src/server/runtime";

/** The request id and CSP nonce for the current request; `null` outside a served request. */
export const requestScopeContext = createContext<RequestScope | null>(null);

/**
 * Root middleware: runs for every document, data and resource request handled by React Router
 * (including the 404 and error pages), so all of them get the security headers, an
 * `X-Request-Id` and a log line (R9 to R11).
 */
export const requestPolicyMiddleware: MiddlewareFunction<Response> = ({ request, context }, next) =>
  runWithRequestPolicy(
    request,
    (scope) => {
      context.set(requestScopeContext, scope);
      return next();
    },
    // The Vite dev server's HMR client needs inline scripts, so only it omits the CSP.
    { logger, sendContentSecurityPolicy: import.meta.env.PROD },
  );
