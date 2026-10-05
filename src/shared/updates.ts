import { z } from 'zod';

/*
 * Updates (Session 14). Releases are published on the public repository's
 * GitHub Releases, only by the release workflow from `main`. Each release
 * carries drashti-update.json: its version, notes and, for each platform,
 * the file to install with its size and SHA-512. Drashti fetches it when an
 * admin checks (or, if an admin allowed it, once a day), and never downloads
 * or installs anything by itself:
 *
 * - an admin downloads it, at a gentle speed, never while the stream is on
 *   air or recording (it waits, and goes on afterwards);
 * - an admin says to install it when Drashti quits; it installs then, and
 *   Drashti never restarts itself; Simple Mode never sees any of this.
 *
 * On Windows the installer runs silently once Drashti has quit. On a Mac the
 * app must be signed for Squirrel.Mac to install it; an unsigned Mac build
 * downloads and checks it, and shows the file to install by hand.
 */

export const UPDATE_MANIFEST = 'drashti-update.json';

/** Where releases are published: GitHub Releases of the public repository. */
export const UPDATE_BASE = 'https://github.com/Priyansh9121/drashti/releases';

/** The manifest of the newest release (null), or of one version (a node matching its Main). */
export function manifestUrl(base: string, version: string | null): string {
  return version === null
    ? `${base}/latest/download/${UPDATE_MANIFEST}`
    : `${base}/download/v${encodeURIComponent(version)}/${UPDATE_MANIFEST}`;
}

export interface UpdateFile {
  platform: 'darwin' | 'win32';
  arch: 'arm64' | 'x64';
  /** A zip of the app (Mac, for Squirrel.Mac), or the NSIS installer (Windows). */
  kind: 'zip' | 'nsis';
  name: string;
  /** Where to download it (absolute, https; http on this computer for the tests' server). */
  url: string;
  size: number;
  /** Base64, as electron-builder writes it. */
  sha512: string;
}

export interface UpdateManifest {
  app: 'drashti';
  version: string;
  releasedAt: string;
  /** What changed, in a few lines. */
  notes: string;
  /** The release's page, where Drashti's source and FFmpeg's sources are too. */
  source: string;
  files: UpdateFile[];
}

const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/u;

export const updateManifestSchema: z.ZodType<UpdateManifest> = z.object({
  app: z.literal('drashti'),
  version: z.string().regex(VERSION),
  releasedAt: z.string().max(64),
  notes: z.string().max(4000),
  source: z.string().max(400),
  files: z
    .array(
      z.object({
        platform: z.enum(['darwin', 'win32']),
        arch: z.enum(['arm64', 'x64']),
        kind: z.enum(['zip', 'nsis']),
        name: z.string().min(1).max(200),
        url: z
          .string()
          .max(2000)
          .refine((u) => u.startsWith('https://') || /^http:\/\/(127\.0\.0\.1|localhost)[:/]/u.test(u), {
            message: 'not an https address',
          }),
        size: z
          .number()
          .int()
          .positive()
          .max(4 * 1024 ** 3),
        sha512: z.string().regex(/^[A-Za-z0-9+/]{86}==$/u),
      }),
    )
    .max(20),
});

/**
 * Compare two versions (semantic versioning): negative when `a` is older.
 * A pre-release is older than its release (1.0.0-alpha.1 < 1.0.0), and its
 * dotted parts compare as numbers where they are numbers.
 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core = '', pre = ''] = v.split(/-(.*)/su);
    return { core: core.split('.').map((n) => Number(n) || 0), pre: pre === '' ? [] : pre.split('.') };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d !== 0) return d;
  }
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/u.test(p);
    const qn = /^\d+$/u.test(q);
    if (pn && qn) {
      const d = Number(p) - Number(q);
      if (d !== 0) return d;
    } else if (pn !== qn) return pn ? -1 : 1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

export type UpdatePhase =
  'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'waiting' | 'ready' | 'error';

export interface UpdateView {
  /** The version running. */
  current: string;
  phase: UpdatePhase;
  /** The version offered (newer than this one; for a node, Main's), with what it says. */
  offer: { version: string; notes: string; size: number; releasedAt: string } | null;
  /** While downloading: bytes so far, of the file's size. */
  progress: { done: number; total: number } | null;
  /** While waiting: why ("the stream is on air or recording"). */
  waitingFor: string | null;
  /** An admin said to install it when Drashti quits. */
  installOnQuit: boolean;
  /** How it installs on this computer: by itself when Drashti quits, or by hand (an unsigned Mac). */
  install: 'at-quit' | 'by-hand';
  /** What went wrong, or something to know (in words), or null. */
  message: string | null;
  /** When it last looked (ms since the epoch), or null. */
  checkedAt: number | null;
  /** An admin allowed a look once a day (never a download). */
  autoCheck: boolean;
}

export type UpdateResult = { ok: true; view: UpdateView } | { ok: false; message: string };
