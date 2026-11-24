/** Types for scripts/fetch-caption-models.mjs (CAP-CI-1 (a): caption models for CI's measuring only). */
export interface CaptionModelSource {
  /** The file's name, as its source names it. */
  name: string;
  /** Its pinned address: https, at an exact release or revision. */
  url: string;
  /** The hosts it may be fetched from, redirects included (".example.org" stands for any name ending so). */
  hosts: readonly string[];
  bytes: number;
  sha256: string;
  licence: string;
  /** What it is, in a few words. */
  what: string;
  /** The environment setting that may give another address for it (one per pack), checked as `releases` says. */
  urlSetting?: string;
  /** With a setting: the release pages' path an address set must be under (one tag, then the same file name). */
  releases?: string;
}
export const CAPTION_MODELS: Readonly<Record<string, CaptionModelSource>>;
export const DEFAULT_CACHE: string;
export function hostAllowed(source: CaptionModelSource, url: string): boolean;
export function refuseInsideCheckout(checkout: string, dir: string): void;
export function fetchCaptionModel(
  id: string,
  options: {
    cacheDir: string;
    fetch: (url: string, init?: RequestInit) => Promise<Response>;
    pause: (ms: number) => Promise<unknown>;
    table?: Readonly<Record<string, CaptionModelSource>>;
    checkout?: string;
    /** Where the address settings are read (process.env when left out). */
    env?: Readonly<Record<string, string | undefined>>;
  },
): Promise<string>;
