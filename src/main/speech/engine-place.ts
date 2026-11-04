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

/**
 * Why this computer cannot run the captions engine, or null when it can: whisper.cpp's library for the Mac needs
 * macOS 13.3 or later (Drashti itself runs from macOS 12). `version` is the system's, as "13.2.1".
 */
export function whisperProblem(platform: NodeJS.Platform, version: string): string | null {
  if (platform !== 'darwin') return null;
  const [major = 0, minor = 0] = version.split('.').map((n) => Number.parseInt(n, 10) || 0);
  return major > 13 || (major === 13 && minor >= 3)
    ? null
    : 'Live captions need macOS 13.3 or later on this Mac.';
}
