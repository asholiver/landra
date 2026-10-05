import {
  isRouteErrorResponse,
  Links,
  Outlet,
  Scripts,
  ScrollRestoration,
  useMatches,
} from "react-router";
import type { Route } from "./+types/root";
import { ErrorPage } from "./components/error-page";
import { requestPolicyMiddleware } from "./lib/request-scope.server";
import { wantsHydration } from "./lib/route-handles";
import stylesUrl from "./styles.css?url";

export const middleware: Route.MiddlewareFunction[] = [requestPolicyMiddleware];

export function Layout({ children }: { children: React.ReactNode }) {
  const hydrate = useMatches().every((match) => wantsHydration(match.handle));
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* R9: every page is noindex until the product is named (ADR-0004). */}
        <meta name="robots" content="noindex, nofollow" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="stylesheet" href={stylesUrl} />
        {/* Links also preloads the route JavaScript, which pages without hydration must not fetch. */}
        {hydrate ? <Links /> : null}
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        {children}
        {hydrate ? (
          <>
            <ScrollRestoration />
            <Scripts />
          </>
        ) : null}
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

// Never shows the error message or a stack trace: those can reveal internals (Security: data
// exposure). Only the status decides the wording.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 500;
  return <ErrorPage status={status} />;
}
