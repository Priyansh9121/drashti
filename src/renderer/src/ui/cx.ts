/** Join class names, skipping false, null and undefined. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** data-* attributes passed through to an element (data-testid and the like). */
export type DataAttributes = Record<`data-${string}`, string | undefined>;
