/** Types for scripts/fetch-indic.mjs (Route C's helper on Microsoft ONNX Runtime 1.23.2; CI's cache, QA23-ORTCACHE-1). */
export interface OrtRelease {
  version: string;
  url: string;
  bytes: number;
  sha256: string;
}
export interface OrtTarget {
  rid: string;
  files: string[];
  bytes: number;
}
export const ORT_RELEASE: Readonly<OrtRelease>;
export const ORT_TARGETS: Readonly<Record<'darwin-arm64' | 'darwin-x64' | 'win32-x64', OrtTarget>>;
/** Where the checked package is kept, relative to the checkout: the one file CI's cache keeps. */
export const ORT_ARCHIVE: string;
export function verifyOrtArchive(file: string, expected?: Pick<OrtRelease, 'bytes' | 'sha256'>): void;
export function verifyOrtFiles(dir: string, target: Pick<OrtTarget, 'files' | 'bytes'>): void;
/** CI's cache key: the exact version, the runner's platform and the pinned SHA-256. */
export function ortCacheKey(
  platform?: string,
  arch?: string,
  release?: Pick<OrtRelease, 'version' | 'sha256'>,
): string;
/** `key=…` and `path=…`, one line each, for $GITHUB_OUTPUT. */
export function ortCacheOutputs(platform?: string, arch?: string): string;
/** The pinned package at `archive`: the one kept there, or downloaded; checked by size and SHA-256 either way. */
export function ensureOrtArchive(
  archive?: string,
  options?: {
    release?: OrtRelease;
    fetch?: (url: string, init: { redirect: 'error' }) => Promise<Response>;
    log?: (line: string) => void;
  },
): Promise<string>;
export function fetchIndic(target: string, output?: string): Promise<string>;
/** The command line: `--cache-key` prints CI's cache outputs and fetches nothing; otherwise it builds the helper. */
export function main(
  args: string[],
  options?: {
    write?: (text: string) => void;
    build?: (target: string, output: string | undefined) => Promise<unknown>;
  },
): Promise<void>;
