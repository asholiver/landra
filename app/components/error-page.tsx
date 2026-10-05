import { PublicShell } from "./public-shell";

type ErrorCopy = { title: string; message: string };

// Fixed wording per status. Nothing from the error itself is ever shown (no message, no stack).
function copyFor(status: number): ErrorCopy {
  if (status === 404) {
    return { title: "Page not found", message: "We could not find the page you asked for." };
  }
  if (status === 503) {
    return {
      title: "Temporarily unavailable",
      message: "The service is not available right now. Please try again in a moment.",
    };
  }
  return {
    title: "Something went wrong",
    message: "An unexpected error occurred. Please try again.",
  };
}

export function ErrorPage({ status }: { status: number }) {
  const { title, message } = copyFor(status);
  return (
    <PublicShell title={title}>
      <h1>{title}</h1>
      <p>{message}</p>
      <p>
        <a href="/">Go to the home page</a>
      </p>
    </PublicShell>
  );
}
