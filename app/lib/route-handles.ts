/**
 * A route sets `handle = withoutHydration` to ship no JavaScript at all (R2: public pages are
 * plain HTML and CSS). The root layout then renders neither `<Scripts>` nor route preloads.
 */
export const withoutHydration = { hydrate: false } as const;

export function wantsHydration(handle: unknown): boolean {
  return !(
    typeof handle === "object" &&
    handle !== null &&
    "hydrate" in handle &&
    handle.hydrate === false
  );
}
