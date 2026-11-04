import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OPENING_COPY_MAX_BYTES } from '../../shared/opening';
import { openingCopyPath, readPack, saveOpeningCopy } from './opening-files';

/*
 * The opening's files (Session 55, the owner's addition of 3 Nov 2026): the opening pack a mandir is given (its
 * photos/1.jpg to 8.jpg and words.txt), read for Load the opening pack…; and the opening's own copy of each photo,
 * at the operator window's size, kept in the media folder's opening/ beside the stills. Generated files and
 * placeholder words only.
 */

let dir: string;
const SHA = 'ab'.repeat(32);
const jpeg = (size = 16) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  b.set([0xff, 0xd9], size - 2);
  return b;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-opening-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A pack of its own with these photos (by number and extension) and these words. */
function pack(photos: [number, string][], words: string | null): string {
  const root = mkdtempSync(join(dir, 'pack-'));
  mkdirSync(join(root, 'photos'), { recursive: true });
  for (const [n, ext] of photos) writeFileSync(join(root, 'photos', `${String(n)}.${ext}`), jpeg());
  if (words !== null) writeFileSync(join(root, 'words.txt'), words);
  return root;
}

const FIVE = 'Placeholder one\nPlaceholder two\nPlaceholder three\nPlaceholder four\nPlaceholder five\n';

describe('the opening pack', () => {
  it('reads photos 1 to 8 in order, whatever their extension’s case, and five lines', async () => {
    const root = pack(
      [
        [3, 'jpg'],
        [1, 'JPG'],
        [2, 'jpeg'],
        [5, 'png'],
        [4, 'jpg'],
        [8, 'jpg'],
        [6, 'jpg'],
        [7, 'jpg'],
      ],
      FIVE,
    );
    // Not a numbered photo: left alone.
    writeFileSync(join(root, 'photos', 'notes.jpg'), jpeg());
    const read = await readPack(root);
    expect(read).toEqual({
      ok: true,
      photos: [
        join(root, 'photos', '1.JPG'),
        join(root, 'photos', '2.jpeg'),
        join(root, 'photos', '3.jpg'),
        join(root, 'photos', '4.jpg'),
        join(root, 'photos', '5.png'),
        join(root, 'photos', '6.jpg'),
        join(root, 'photos', '7.jpg'),
        join(root, 'photos', '8.jpg'),
      ],
      lines: [
        'Placeholder one',
        'Placeholder two',
        'Placeholder three',
        'Placeholder four',
        'Placeholder five',
      ],
    });
  });

  it('takes the first five lines of more, and says what a pack is missing, changing nothing', async () => {
    const more = await readPack(
      pack(
        [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, 'jpg']),
        `${FIVE}Placeholder six\n`,
      ),
    );
    expect(more.ok && more.lines).toHaveLength(5);
    expect(
      await readPack(
        pack(
          [1, 2, 3, 4, 5, 6].map((n) => [n, 'jpg']),
          'Placeholder one\n',
        ),
      ),
    ).toEqual({
      ok: false,
      message:
        'The opening pack is missing photos 7 and 8 (photos/7.jpg and photos/8.jpg), and has 1 line of the 5 in words.txt. Nothing was changed.',
    });
  });

  it('a folder that is not a pack: no photos folder, no words.txt', async () => {
    mkdirSync(join(dir, 'empty'));
    expect(await readPack(join(dir, 'empty'))).toEqual({
      ok: false,
      message:
        'The opening pack is missing photos 1, 2, 3, 4, 5, 6, 7 and 8 (photos/1.jpg, photos/2.jpg, photos/3.jpg, photos/4.jpg, photos/5.jpg, photos/6.jpg, photos/7.jpg and photos/8.jpg), and has no lines in words.txt. Nothing was changed.',
    });
    expect(await readPack(join(dir, 'not-there'))).toMatchObject({ ok: false });
  });
});

describe('the opening’s copy of each photo', () => {
  it('keeps a JPEG under the photo’s sha256 in the media folder’s opening/, replacing an older one', async () => {
    expect(openingCopyPath(SHA)).toBe(`opening/${SHA}.jpg`);
    expect(await saveOpeningCopy(dir, SHA, jpeg())).toEqual({ ok: true });
    expect(new Uint8Array(readFileSync(join(dir, openingCopyPath(SHA))))).toEqual(jpeg());
    expect(await saveOpeningCopy(dir, SHA, jpeg(40))).toEqual({ ok: true });
    expect(readFileSync(join(dir, openingCopyPath(SHA)))).toHaveLength(40);
    expect(readdirSync(join(dir, 'opening'))).toEqual([`${SHA}.jpg`]);
  });

  it('refuses anything but one whole JPEG of a sensible size, or a name that is not a sha256', async () => {
    for (const bytes of [jpeg().subarray(0, 10), 'not bytes', null, jpeg(OPENING_COPY_MAX_BYTES + 2)])
      expect(await saveOpeningCopy(dir, SHA, bytes)).toMatchObject({ ok: false });
    for (const sha of ['../../evil', 'AB'.repeat(32), ''])
      expect(await saveOpeningCopy(dir, sha, jpeg())).toMatchObject({ ok: false });
    expect(existsSync(join(dir, 'opening'))).toBe(false);
  });
});
