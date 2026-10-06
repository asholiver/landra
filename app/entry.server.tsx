import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";
import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import { requestScopeContext } from "./lib/request-scope.server";

// Standard Node streaming renderer (it does not import any host adapter, so the same entry
// serves the standalone Node build and Vercel). The only addition to React Router's default is
// the CSP nonce: the request policy (root middleware) creates it, and it is handed to both
// React and ServerRouter so every inline script React Router emits carries it.
export const streamTimeout = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider,
) {
  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }

  // Absent only while prerendering at build time, where no inline script is ever emitted.
  const nonce = loadContext.get(requestScopeContext)?.nonce;

  return new Promise<Response>((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");
    // Crawlers wait for the full page; everyone else gets the shell as soon as it is ready.
    const readyOption =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady";

    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => abort(),
      streamTimeout + 1000,
    );

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
      {
        nonce,
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html; charset=utf-8");
          pipe(body);
          resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }));
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Errors during the initial shell are rejected and logged by React Router; only
          // later streaming errors are reported here (message only, never a stack to the client).
          if (shellRendered) {
            console.error(error instanceof Error ? error.message : "render error");
          }
        },
      },
    );
  });
}
