import { PublicShell } from "../components/public-shell";
import { withoutHydration } from "../lib/route-handles";

export const handle = withoutHydration;

// Prerendered, so it cannot know the query string or the visitor's session at build time. The
// small external script public/sign-in.js reveals the matching message below from `?error=`
// (a fixed code, never echoed), copies `returnTo` into the form for the server to re-sanitise,
// shows the loading state, and sends an already signed-in visitor on their way.
export default function SignIn() {
  return (
    <PublicShell title="Sign in">
      <h1>Sign in</h1>
      <p className="alert alert-error" role="alert" data-sign-in-message="not_configured" hidden>
        Google sign-in is not configured in this environment.
      </p>
      <p className="alert alert-error" role="alert" data-sign-in-message="failed" hidden>
        We could not sign you in. Access may not be available for this account. Please try again.
      </p>
      <form method="post" action="/sign-in/google" data-sign-in-form>
        <input type="hidden" name="returnTo" defaultValue="" />
        <button className="button" type="submit" data-sign-in-button>
          Continue with Google
        </button>
        <p className="muted" role="status" data-sign-in-status hidden>
          Redirecting to Google…
        </p>
      </form>
      <script src="/sign-in.js" defer />
    </PublicShell>
  );
}
