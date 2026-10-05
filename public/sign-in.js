// Progressive enhancement for the prerendered sign-in page. The page works without it (the form
// posts to the server); this adds the query-dependent parts a static page cannot know.
// Served from this origin, so the CSP needs no inline script. Nothing from the URL is ever
// written into the page: `error` only selects one of the fixed messages already in the HTML.
(() => {
  const params = new URLSearchParams(window.location.search);

  if (params.has("error")) {
    const code = params.get("error") === "not_configured" ? "not_configured" : "failed";
    const message = document.querySelector(`[data-sign-in-message="${code}"]`);
    if (message) message.removeAttribute("hidden");
  }

  // The server re-sanitises returnTo; it is only carried through here.
  const returnTo = params.get("returnTo");
  const returnToField = document.querySelector('input[name="returnTo"]');
  if (returnTo && returnToField) returnToField.value = returnTo;

  const form = document.querySelector("[data-sign-in-form]");
  const button = document.querySelector("[data-sign-in-button]");
  const status = document.querySelector("[data-sign-in-status]");
  if (form && button && status) {
    form.addEventListener("submit", () => {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      status.removeAttribute("hidden");
    });
  }

  // A visitor who is already signed in goes straight on, to the server-sanitised path.
  const statusUrl = returnTo
    ? `/sign-in/status?returnTo=${encodeURIComponent(returnTo)}`
    : "/sign-in/status";
  fetch(statusUrl, { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : null))
    .then((result) => {
      const target = result?.redirectTo;
      // Belt and braces: only ever follow a same-origin relative path.
      if (result?.signedIn === true && typeof target === "string") {
        if (target.startsWith("/") && !target.startsWith("//")) window.location.replace(target);
      }
    })
    .catch(() => {
      // Not signed in, or the check is unavailable: the page stays as it is.
    });
})();
