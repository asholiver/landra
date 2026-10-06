import { healthPayload, resolveVersion } from "../../src/server/health";

// Liveness only: no database access and no dependency on the full configuration, so the
// check still answers when other settings are wrong.
export function loader() {
  return Response.json(healthPayload(resolveVersion(process.env)), {
    headers: { "Cache-Control": "no-store" },
  });
}
