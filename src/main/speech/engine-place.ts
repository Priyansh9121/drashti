import { existsSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Where the captions engine is (scripts/fetch-whisper.mjs puts it there, Session 55, Part 10): in the app's resources
 * when packaged, in vendor/whisper/<platform>-<arch> when run from the repository. Windows: whisper.cpp's own
 * whisper-server.exe; a Mac: drashti-whisper, our small program on whisper.cpp's prebuilt library.
 */

export interface WhisperPlace {
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
  platform: NodeJS.Platform;
  arch: string;
}

export function whisperCandidates(p: WhisperPlace): string[] {
  const exe = p.platform === 'win32' ? 'whisper-server.exe' : 'drashti-whisper';
  return p.packaged
    ? [join(p.resourcesPath, 'whisper', exe)]
    : [join(p.appPath, 'vendor', 'whisper', `${p.platform}-${p.arch}`, exe)];
}

/** The engine program, or null when this copy of Drashti has none (then captions say so). */
export function findWhisper(p: WhisperPlace): string | null {
  return whisperCandidates(p).find((c) => existsSync(c)) ?? null;
}
