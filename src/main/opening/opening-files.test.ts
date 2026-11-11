import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OPENING_COPY_MAX_BYTES, OPENING_SOUND_MAX_BYTES } from '../../shared/opening';
import {
  dropSoundCopy,
  keepSoundCopy,
  openingCopyPath,
  openingSoundPath,
  readPack,
  saveOpeningCopy,
} from './opening-files';

/*
 * The opening's files (Session 55, and alpha.16: the owner's words of 11 Nov 2026): the opening pack a mandir is given
 * (now its photos/1.jpg and, if it has one, its sound.mp3, sound.m4a or sound.wav), read for Load the opening pack…;
 * the opening's own copy of its photo, at the operator window's size; and the copy of its sound Drashti keeps, both in
 * the media folder's opening/ beside the stills. Generated files (made-up headers and tones) and placeholder names
 * only: the mandir's own pack never comes near a test.
 */

let dir: string;
const SHA = 'ab'.repeat(32);
const jpeg = (size = 16) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  b.set([0xff, 0xd9], size - 2);
  return b;
};

/** A WAV of a quiet placeholder tone (16-bit mono PCM), `ms` long. */
function wav(ms = 300): Buffer {
  const rate = 8000;
  const data = Buffer.alloc(Math.round((ms / 1000) * rate) * 2);
  for (let i = 0; i < data.length / 2; i++)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 2000), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8, 'latin1');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'latin1');
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** An ISO media box. */
const box = (type: string, ...body: Buffer[]) => {
  const content = Buffer.concat(body);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + content.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, content]);
};

/** An M4A's head: its brand and one sound track of `codec` (its frames left out: only the head is read). */
const m4a = (codec: string) =>
  Buffer.concat([
    box('ftyp', Buffer.from('M4A \0\0\0\0M4A mp42isom', 'latin1')),
    box(
      'moov',
      box(
        'trak',
        box(
          'mdia',
          box('hdlr', Buffer.alloc(8), Buffer.from('soun', 'latin1'), Buffer.alloc(12)),
          box('minf', box('stbl', box('stsd', Buffer.alloc(8), box(codec, Buffer.alloc(28))))),
        ),
      ),
    ),
  ]);

/** An MP3's head: its ID3 tag, then a frame's sync. */
const mp3 = () =>
  Buffer.concat([
    Buffer.from('ID3\u0004\0\0\0\0\0\0', 'latin1'),
    Buffer.from([0xff, 0xfb, 0x90, 0x64]),
    Buffer.alloc(400),
  ]);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-opening-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A pack of its own with these photos (by number and extension), these files at its top, and these words. */
function pack(
  photos: [number, string][],
  top: Record<string, Uint8Array | string> = {},
  words: string | null = null,
): string {
  const root = mkdtempSync(join(dir, 'pack-'));
  mkdirSync(join(root, 'photos'), { recursive: true });
  for (const [n, ext] of photos) writeFileSync(join(root, 'photos', `${String(n)}.${ext}`), jpeg());
  for (const [name, bytes] of Object.entries(top)) writeFileSync(join(root, name), bytes);
  if (words !== null) writeFileSync(join(root, 'words.txt'), words);
  return root;
}

const FIVE = 'Placeholder one\nPlaceholder two\nPlaceholder three\nPlaceholder four\nPlaceholder five\n';

describe('the opening pack', () => {
  it('needs only its photo 1, whatever its extension’s case: no words.txt, no sound', async () => {
    const root = pack([[1, 'JPG']]);
    expect(await readPack(root)).toEqual({ ok: true, photo: join(root, 'photos', '1.JPG'), sound: null });
  });

  it('an alpha.15 pack still loads: its photo 1 only, photos 2 to 8 and words.txt left alone', async () => {
    const root = pack(
      [3, 1, 2, 4, 5, 6, 7, 8].map((n) => [n, n === 5 ? 'png' : 'jpg']),
      {},
      FIVE,
    );
    writeFileSync(join(root, 'photos', 'notes.jpg'), jpeg());
    expect(await readPack(root)).toEqual({ ok: true, photo: join(root, 'photos', '1.jpg'), sound: null });
  });

  it('a pack without its photo 1 says so, and nothing changes', async () => {
    const missing = 'The opening pack has no photo 1 (photos/1.jpg). Nothing was changed.';
    expect(await readPack(pack([[2, 'jpg']], { 'sound.wav': wav() }))).toEqual({
      ok: false,
      message: missing,
    });
    mkdirSync(join(dir, 'empty'));
    expect(await readPack(join(dir, 'empty'))).toEqual({ ok: false, message: missing });
    expect(await readPack(join(dir, 'not-there'))).toEqual({ ok: false, message: missing });
  });

  it('finds its sound at its top: sound.mp3, sound.m4a or sound.wav, in any case', async () => {
    for (const [name, bytes, kind] of [
      ['sound.mp3', mp3(), 'mp3'],
      ['Sound.M4A', m4a('mp4a'), 'm4a'],
      ['SOUND.WAV', wav(), 'wav'],
    ] as const) {
      const root = pack([[1, 'jpg']], { [name]: bytes });
      expect(await readPack(root), name).toEqual({
        ok: true,
        photo: join(root, 'photos', '1.jpg'),
        sound: { path: join(root, name), name, kind },
      });
    }
    // A folder of that name is not its sound.
    const root = pack([[1, 'jpg']]);
    mkdirSync(join(root, 'sound.mp3'));
    expect(await readPack(root)).toMatchObject({ ok: true, sound: null });
  });

  it('refuses a sound that is too big, not a sound, or one Drashti cannot play, in plain words; and two sounds', async () => {
    const big = pack([[1, 'jpg']], { 'sound.wav': wav() });
    truncateSync(join(big, 'sound.wav'), OPENING_SOUND_MAX_BYTES + 1);
    expect(await readPack(big)).toEqual({
      ok: false,
      message:
        'The opening pack’s sound.wav is too big: the opening’s sound can be at most 10 MB, and only its first two seconds play. Nothing was changed.',
    });
    const after = 'Its sound must be an MP3, an M4A (AAC) or a WAV. Nothing was changed.';
    expect(await readPack(pack([[1, 'jpg']], { 'sound.wav': jpeg(64) }))).toEqual({
      ok: false,
      message: `Drashti cannot play the opening pack’s sound.wav as it is: JPEG picture. ${after}`,
    });
    expect(await readPack(pack([[1, 'jpg']], { 'sound.mp3': 'Placeholder words, not a sound' }))).toEqual({
      ok: false,
      message: `Drashti cannot play the opening pack’s sound.mp3 as it is: file of a kind Drashti does not recognise. ${after}`,
    });
    expect(await readPack(pack([[1, 'jpg']], { 'sound.m4a': m4a('alac') }))).toEqual({
      ok: false,
      message: `Drashti cannot play the opening pack’s sound.m4a as it is: Apple Lossless sound file (M4A). ${after}`,
    });
    expect(await readPack(pack([[1, 'jpg']], { 'sound.mp3': new Uint8Array() }))).toEqual({
      ok: false,
      message: `Drashti cannot play the opening pack’s sound.mp3 as it is: empty file. ${after}`,
    });
    expect(await readPack(pack([[1, 'jpg']], { 'sound.wav': wav(), 'sound.mp3': mp3() }))).toEqual({
      ok: false,
      message:
        'The opening pack has more than one sound (sound.mp3 and sound.wav): keep one of them. Nothing was changed.',
    });
  });
});

describe('the copy of the pack’s sound Drashti keeps', () => {
  it('is kept whole in the media folder’s opening/, named by its sha256 and its kind', async () => {
    const root = pack([[1, 'jpg']], { 'Sound.WAV': wav(500) });
    const bytes = readFileSync(join(root, 'Sound.WAV'));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const kept = await keepSoundCopy(dir, { path: join(root, 'Sound.WAV'), name: 'Sound.WAV', kind: 'wav' });
    expect(kept).toEqual({ ok: true, sound: { sha256, kind: 'wav', name: 'Sound.WAV' } });
    expect(openingSoundPath({ sha256, kind: 'wav' })).toBe(`opening/${sha256}.wav`);
    expect(readFileSync(join(dir, 'opening', `${sha256}.wav`))).toEqual(bytes);
    // Kept again: the same file, nothing left over.
    expect(
      await keepSoundCopy(dir, { path: join(root, 'Sound.WAV'), name: 'Sound.WAV', kind: 'wav' }),
    ).toEqual(kept);
    expect(readdirSync(join(dir, 'opening'))).toEqual([`${sha256}.wav`]);
    // Taken out: gone; taking out one that is not there is no harm.
    await dropSoundCopy(dir, { sha256, kind: 'wav', name: 'Sound.WAV' });
    expect(readdirSync(join(dir, 'opening'))).toEqual([]);
    await dropSoundCopy(dir, { sha256, kind: 'wav', name: 'Sound.WAV' });
  });

  it('never keeps more than the most a sound may be, nor a file that is gone', async () => {
    const root = pack([[1, 'jpg']], { 'sound.wav': wav() });
    truncateSync(join(root, 'sound.wav'), OPENING_SOUND_MAX_BYTES + 1);
    expect(
      await keepSoundCopy(dir, { path: join(root, 'sound.wav'), name: 'sound.wav', kind: 'wav' }),
    ).toMatchObject({ ok: false });
    expect(
      await keepSoundCopy(dir, { path: join(root, 'gone.wav'), name: 'gone.wav', kind: 'wav' }),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/^Could not keep the opening’s sound\./u) });
    expect(existsSync(join(dir, 'opening')) ? readdirSync(join(dir, 'opening')) : []).toEqual([]);
  });
});

describe('the opening’s copy of its photo', () => {
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
