import { PRODUCT_NAME } from "../../src/shared/product";

export default function AppHome() {
  return (
    <>
      <title>{`Pipeline | ${PRODUCT_NAME}`}</title>
      <h1>Pipeline</h1>
      <section className="empty-state" aria-labelledby="empty-pipeline">
        <h2 id="empty-pipeline">Your pipeline will appear here</h2>
        <p>Nothing to show yet.</p>
      </section>
    </>
  );
}
