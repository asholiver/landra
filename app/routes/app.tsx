import { Outlet } from "react-router";
import { PRODUCT_NAME } from "../../src/shared/product";
import { requireUser } from "../lib/require-user.server";
import type { Route } from "./+types/app";

// Everything under /app is per-user, so no cache (browser, proxy or CDN) may store it. Applies
// to document and .data responses alike, including the 404 inside the shell.
export const middleware: Route.MiddlewareFunction[] = [
  async (_args, next) => {
    const response = await next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  },
];

// Guards `/app` and every route under it (R3, AC8): signed-out requests redirect to /sign-in
// with a sanitised return path before anything below renders.
export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return { user: { name: user.name, image: user.image ?? null } };
}

function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase());
  return letters.join("") || "?";
}

export default function AppShell({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;
  return (
    <>
      <header className="site-header">
        <div className="container site-header-inner">
          <a className="brand" href="/app">
            {PRODUCT_NAME}
          </a>
          <div className="account">
            {user.image ? (
              <img
                className="avatar"
                src={user.image}
                alt=""
                width="32"
                height="32"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="avatar avatar-initials" aria-hidden="true">
                {initialsOf(user.name)}
              </span>
            )}
            <span className="account-name">{user.name}</span>
            <form method="post" action="/sign-out">
              <button className="button button-secondary" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" className="container page">
        <Outlet />
      </main>
    </>
  );
}
