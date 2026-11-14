/** Types for scripts/fetch-ci-ffmpeg.mjs (Session 58, CI-1: CI's own Linux FFmpeg for the unit tests). */
export interface CiFfmpegBuild {
  name: string;
  url: string;
  sha256: string;
  member: string;
}
export const CI_FFMPEG: CiFfmpegBuild;
export function ciFfmpegDir(checkout: string): string;
export function fetchCiFfmpeg(options: {
  build?: CiFfmpegBuild;
  cacheDir: string;
  outDir: string;
  fetch: (url: string) => Promise<Response>;
  pause: (ms: number) => Promise<unknown>;
  unpack?: (archive: string, member: string, into: string) => string;
}): Promise<{ ok: true; path: string } | { ok: false; why: string }>;
export function annotation(kind: 'warning' | 'error' | 'notice', title: string, message: string): string;
