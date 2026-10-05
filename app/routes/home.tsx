import { PRODUCT_NAME } from "../../src/shared/product";
import { PublicShell } from "../components/public-shell";
import { withoutHydration } from "../lib/route-handles";

export const handle = withoutHydration;

export default function Home() {
  return (
    <PublicShell title={PRODUCT_NAME}>
      <meta name="description" content="A private workspace for managing a job search." />
      <h1>{PRODUCT_NAME}</h1>
      <p className="lead">A private workspace for managing your job search.</p>
      <p>
        <a className="button" href="/sign-in">
          Sign in
        </a>
      </p>
    </PublicShell>
  );
}
