export const CTRANSLATE2_VERSION: string;
export const SENTENCEPIECE_VERSION: string;
export const SOURCES: { name: string; url: string; sha256: string; into: string }[];
export const TARGETS: Record<string, { exe: string; arch: string }>;
export function fetchTranslate(target: string, options?: { jobs?: number }): Promise<string>;
export function macJobs(
  target: string,
  trees: { ct2: string; spm: string },
  work: string,
): { jobs: { src: string; name: string; flags: string[] }[]; archFlags: string[] };
