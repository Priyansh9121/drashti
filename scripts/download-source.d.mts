/** Types for scripts/download-source.mjs (Session 47; a source's backup, 5 Nov 2026). */
export const PAUSES_MS: number[];
export function downloadSource(
  source: { name: string; url: string } | { name: string; url: string; backup: string; sha256: string },
  file: string,
  fetch: (url: string) => Promise<Response>,
  pause: (ms: number) => Promise<unknown>,
): Promise<void>;
