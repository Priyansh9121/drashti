import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { VideoOutSender } from './protocol';

/*
 * How this computer's Drashti sends its picture to other software (x30; the owner's "Go, all A"): Syphon on a Mac and
 * Spout on Windows, by Drashti's own small program (tools/video-out/, built by scripts/fetch-video-out.mjs): in the
 * app's resources when packaged (video-out/), in vendor/video-out/<platform>-<arch>/ when run from the repository.
 * The tests' stand-in receiver instead when a test names its file (DRASHTI_TEST_VIDEO_OUT_STAND_IN, honoured only
 * when Drashti is not packaged: src/main/switches.ts). None elsewhere, or when the program is missing: then video out
 * is not offered.
 */

export interface VideoOutPlace {
  standIn: string | null;
  platform: NodeJS.Platform;
  arch: string;
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
}

/** Where this computer's program would be, or null where Drashti has no way to send. */
export function videoOutProgram(place: Omit<VideoOutPlace, 'standIn'>): string | null {
  const exe =
    place.platform === 'darwin'
      ? 'drashti-video-out'
      : place.platform === 'win32'
        ? 'drashti-video-out.exe'
        : null;
  if (!exe) return null;
  return place.packaged
    ? join(place.resourcesPath, 'video-out', exe)
    : join(place.appPath, 'vendor', 'video-out', `${place.platform}-${place.arch}`, exe);
}

export function videoOutSender(
  place: VideoOutPlace,
  exists: (file: string) => boolean = existsSync,
): VideoOutSender | null {
  if (place.standIn) return { way: 'stand-in', file: place.standIn };
  const program = videoOutProgram(place);
  if (!program || !exists(program)) return null;
  return { way: place.platform === 'darwin' ? 'syphon' : 'spout', program };
}
