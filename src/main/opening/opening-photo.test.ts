import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OPENING_PHOTO_FILE, openingPhotoPlace, openingPhotoThere } from './opening-photo';

/*
 * Drashti's default opening photo (the owner's decision of 5 Nov 2026): where it is, beside an installed Drashti and in
 * the repository; a test's own picture instead, and never Drashti's in a test that gives none; packed beside the app
 * on the Mac and Windows both; and credited in LICENSES/opening. Generated files only: no test reads the photo.
 */

const app = process.cwd();
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-opening-photo-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('where the default opening photo is', () => {
  it('beside an installed Drashti in its resources’ opening folder, and in the repository’s resources/opening', () => {
    const resources = join('/Applications', 'Drashti.app', 'Contents', 'Resources');
    expect(
      openingPhotoPlace({
        packaged: true,
        resourcesPath: resources,
        appPath: '',
        test: undefined,
        testing: false,
      }),
    ).toEqual({ dir: join(resources, 'opening'), file: join(resources, 'opening', 'default.jpg') });
    expect(OPENING_PHOTO_FILE).toBe('default.jpg');
    expect(
      openingPhotoPlace({
        packaged: false,
        resourcesPath: '/nowhere',
        appPath: app,
        test: undefined,
        testing: false,
      }),
    ).toEqual({
      dir: join(app, 'resources', 'opening'),
      file: join(app, 'resources', 'opening', 'default.jpg'),
    });
  });

  it('in a test, the test’s own picture (DRASHTI_TEST_OPENING_PHOTO); none without one; empty asks for Drashti’s own', () => {
    const own = join(dir, 'placeholder-opening.png');
    const at = { packaged: false, resourcesPath: '/nowhere', appPath: app };
    expect(openingPhotoPlace({ ...at, test: own, testing: true })).toEqual({ dir, file: own });
    // A test that gives no picture never sees Drashti's photo: none at all (the lamp).
    expect(openingPhotoPlace({ ...at, test: undefined, testing: true })).toBeNull();
    // Given empty, the switch is off: Drashti's own photo, found as Drashti finds it (a check of that, never kept).
    expect(openingPhotoPlace({ ...at, test: '', testing: true })?.file).toBe(
      join(app, 'resources', 'opening', 'default.jpg'),
    );
  });

  it('is there only when its file is', () => {
    const file = join(dir, 'placeholder.png');
    expect(openingPhotoThere(null)).toBe(false);
    expect(openingPhotoThere({ dir, file })).toBe(false);
    writeFileSync(file, Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
    expect(openingPhotoThere({ dir, file })).toBe(true);
    const folder = join(dir, 'a-folder.png');
    mkdirSync(folder);
    expect(openingPhotoThere({ dir, file: folder })).toBe(false);
  });
});

describe('the default opening photo as shipped', () => {
  it('is packed beside the app on the Mac and Windows both, the photo alone (electron-builder.yml)', () => {
    const yml = readFileSync(join(app, 'electron-builder.yml'), 'utf8');
    // The top-level extraResources: every platform's package has it.
    const top = /^extraResources:\n((?: {2}.*\n|\s*\n)+)/mu.exec(yml)?.[1] ?? '';
    expect(top).toMatch(/- from: resources\/opening\n\s+to: opening\n\s+filter:\n\s+- default\.jpg\n/u);
  });

  it('is credited to BAPS in LICENSES/opening, under no open licence, built in by the owner’s decision', () => {
    const credit = readFileSync(join(app, 'LICENSES', 'opening', 'README.md'), 'utf8');
    expect(credit).toContain('BAPS');
    expect(credit).toContain('Swamishri');
    expect(credit).toContain('5 November 2026');
    expect(credit).toMatch(/no open licence/u);
  });
});
