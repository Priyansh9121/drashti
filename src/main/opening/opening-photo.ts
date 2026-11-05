import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/*
 * Drashti's default opening photo (the owner's decision of 5 Nov 2026, for this one photo only): a photograph of
 * Swamishri, by BAPS (LICENSES/opening/README.md), what the opening shows when nothing is chosen (shared/opening.ts).
 * Beside an installed Drashti in its resources' opening/ (electron-builder.yml's extraResources, the Mac's and Windows'
 * alike), and in resources/opening/ in the repository; served to the operator window alone, as
 * drashti-media://opening-default/photo (media/media-protocol.ts). Its file missing, the lamp plays instead, as before,
 * and the log says so.
 *
 * No test ever shows it: a test's Drashti shows the test's own generated picture (DRASHTI_TEST_OPENING_PHOTO, which
 * tests/global-setup.ts gives every Drashti a test starts, and a packaged Drashti never reads), and with none given,
 * none at all. Given empty, that switch is off: Drashti's own photo, found as Drashti finds it (a one-off check that it
 * is found, never a test that is kept).
 */

/** The photo's file, in its folder. */
export const OPENING_PHOTO_FILE = 'default.jpg';

/** Where the photo is: its file, and the folder it must be inside. */
export interface OpeningPhotoPlace {
  dir: string;
  file: string;
}

export function openingPhotoPlace(p: {
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
  /** DRASHTI_TEST_OPENING_PHOTO as this Drashti reads it (never when packaged). */
  test: string | undefined;
  /** A test runs (any DRASHTI_TEST_* switch is honoured). */
  testing: boolean;
}): OpeningPhotoPlace | null {
  if (p.test) return { dir: dirname(p.test), file: p.test };
  if (p.testing && p.test === undefined) return null;
  const dir = p.packaged ? join(p.resourcesPath, 'opening') : join(p.appPath, 'resources', 'opening');
  return { dir, file: join(dir, OPENING_PHOTO_FILE) };
}

/** Whether the photo is there (a file, not a folder). */
export function openingPhotoThere(place: OpeningPhotoPlace | null): boolean {
  if (!place) return false;
  try {
    return statSync(place.file).isFile();
  } catch {
    return false;
  }
}
