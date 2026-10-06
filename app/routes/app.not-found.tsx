import { data } from "react-router";
import { PRODUCT_NAME } from "../../src/shared/product";
import { requireUser } from "../lib/require-user.server";
import type { Route } from "./+types/app.not-found";

// Unknown paths under /app: signed-out visitors are redirected to sign in like any /app request;
// signed-in users get a 404 inside the shell.
export async function loader({ request }: Route.LoaderArgs) {
  await requireUser(request);
  return data(null, { status: 404 });
}

export default function AppNotFound() {
  return (
    <>
      <title>{`Page not found | ${PRODUCT_NAME}`}</title>
      <h1>Page not found</h1>
      <p>We could not find the page you asked for.</p>
      <p>
        <a href="/app">Back to your pipeline</a>
      </p>
    </>
  );
}
