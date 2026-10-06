import { getAuth } from "../../src/server/runtime";
import type { Route } from "./+types/api.auth.$";

// Better Auth handler for GET and POST under /api/auth/*.
export function loader({ request }: Route.LoaderArgs) {
  return getAuth().handler(request);
}

export function action({ request }: Route.ActionArgs) {
  return getAuth().handler(request);
}
