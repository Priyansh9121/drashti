import { existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';

/*
 * Where drashti-translate is (scripts/fetch-translate.mjs builds it there, alpha.22): in the app's resources when
 * packaged, in vendor/translate/<platform>-<arch> when run from the repository. A copy without it has no Prepare
 * translations (the dialog says so); nothing else changes.
 */

export interface HelperPlace {
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
  platform: NodeJS.Platform;
  arch: string;
}

export function translateHelperCandidates(p: HelperPlace): string[] {
  const exe = p.platform === 'win32' ? 'drashti-translate.exe' : 'drashti-translate';
  // Joined the way that platform writes paths, whichever computer works it out.
  const paths = p.platform === 'win32' ? win32 : posix;
  return p.packaged
    ? [paths.join(p.resourcesPath, 'translate', exe)]
    : [paths.join(p.appPath, 'vendor', 'translate', `${p.platform}-${p.arch}`, exe)];
}

/** The helper program, or null when this copy of Drashti has none. */
export function findTranslateHelper(p: HelperPlace): string | null {
  return translateHelperCandidates(p).find((c) => existsSync(c)) ?? null;
}
