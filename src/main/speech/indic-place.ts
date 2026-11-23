import { existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import type { WhisperPlace } from './engine-place';

export function indicCandidates(p: WhisperPlace): string[] {
  if (!(
    (p.platform === 'darwin' && (p.arch === 'arm64' || p.arch === 'x64')) ||
    (p.platform === 'win32' && p.arch === 'x64')
  ))
    return [];
  const paths = p.platform === 'win32' ? win32 : posix;
  const name = p.platform === 'win32' ? 'ic-ctc.exe' : 'ic-ctc';
  return [
    p.packaged
      ? paths.join(p.resourcesPath, 'indic', name)
      : paths.join(p.appPath, 'vendor', 'indic', `${p.platform}-${p.arch}`, name),
  ];
}
export function findIndic(p: WhisperPlace): string | null {
  return indicCandidates(p).find((path) => existsSync(path)) ?? null;
}
