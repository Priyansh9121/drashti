/** Types for scripts/download-source.mjs (Session 47). */
export const PAUSES_MS: number[];
export function downloadSource(
  source: { name: string; url: string },
  file: string,
  fetch: (url: string) => Promise<Response>,
  pause: (ms: number) => Promise<unknown>,
): Promise<void>;
