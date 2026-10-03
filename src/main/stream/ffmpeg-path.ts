import { existsSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Where the bundled FFmpeg is (scripts/fetch-ffmpeg.mjs puts it there):
 * in the app's resources when packaged, in vendor/ffmpeg/<platform>-<arch>
 * when run from the repository. DRASHTI_FFMPEG can point elsewhere.
 */

export interface FfmpegPlace {
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
  platform: NodeJS.Platform;
  arch: string;
  override?: string | undefined;
}

export function ffmpegCandidates(p: FfmpegPlace): string[] {
  const exe = p.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  if (p.override) return [p.override];
  return p.packaged
    ? [join(p.resourcesPath, 'ffmpeg', exe)]
    : [join(p.appPath, 'vendor', 'ffmpeg', `${p.platform}-${p.arch}`, exe)];
}

/** The FFmpeg to run, or null when it is missing (then streaming and converting say so). */
export function findFfmpeg(p: FfmpegPlace): string | null {
  return ffmpegCandidates(p).find((c) => existsSync(c)) ?? null;
}
