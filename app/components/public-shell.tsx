import { PRODUCT_NAME } from "../../src/shared/product";

/** Header and main landmark shared by the public pages. Plain anchors: these pages ship no JS. */
export function PublicShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      {/* React 19 hoists these into the document head. */}
      <title>{title === PRODUCT_NAME ? title : `${title} | ${PRODUCT_NAME}`}</title>
      <header className="site-header">
        <div className="container site-header-inner">
          <a className="brand" href="/">
            {PRODUCT_NAME}
          </a>
        </div>
      </header>
      <main id="main" className="container page">
        {children}
      </main>
    </>
  );
}
