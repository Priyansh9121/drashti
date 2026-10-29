import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kindRank } from '../../shared/folder-order';
import { waitingKind } from '../../shared/links';
import { IMAGE_EXTENSIONS, IMAGE_FILE_FILTER, imageShownAsIs } from '../../shared/media';
import { ADD_ACCEPT } from '../../shared/phone-files';
import { contentTypeOf } from '../media/media-protocol';
import { copyExtOf } from '../media/sharpened';
import { whatFileIs } from './file-kind';
import { probeMedia } from './probe';
import { importableExtensions, mediaKindOf } from './scan';

/*
 * Every picture type, every way in (Session 55, Part 5): one list of the pictures Drashti takes, used wherever
 * pictures come in (Import…, Add files…, a drop, the drop folder, a folder playlist, a Dropbox folder, a phone, and
 * the wallpapers' Import…), with the common types Chromium or the bundled FFmpeg reads that were missing.
 */

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-picture-types-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const file = (name: string, bytes: Buffer) => {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
};

/** An ICO holding one 16 × 16 picture (its directory only: enough for its first bytes). */
const ICO = Buffer.concat([
  Buffer.from([0, 0, 1, 0, 1, 0]),
  Buffer.from([16, 16, 0, 0, 1, 0, 32, 0]),
  Buffer.from([0x68, 0x04, 0, 0, 22, 0, 0, 0]),
  Buffer.alloc(64),
]);
/** A Photoshop file's header: "8BPS", version 1. */
const PSD = Buffer.concat([Buffer.from('8BPS'), Buffer.from([0, 1]), Buffer.alloc(64)]);
/** A JPEG 2000 file (its signature box), and a bare JPEG 2000 codestream. */
const JP2 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a]),
  Buffer.alloc(64),
]);
const J2K = Buffer.concat([Buffer.from([0xff, 0x4f, 0xff, 0x51]), Buffer.alloc(64)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]);

describe('one list of the pictures Drashti takes (Session 55, Part 5)', () => {
  it('holds the eleven of before and the common ones Chromium or FFmpeg reads that were missing', () => {
    expect(IMAGE_EXTENSIONS).toEqual(
      expect.arrayContaining([
        'jpg',
        'jpeg',
        'png',
        'gif',
        'bmp',
        'tif',
        'tiff',
        'heic',
        'heif',
        'webp',
        'avif',
      ]),
    );
    expect(IMAGE_EXTENSIONS).toEqual(
      expect.arrayContaining(['jfif', 'jpe', 'pjpeg', 'pjp', 'apng', 'ico', 'tga', 'psd', 'jp2', 'j2k']),
    );
    // The bundled FFmpeg reads no JPEG XL, and an SVG is a drawing, not a picture: neither is taken.
    expect(IMAGE_EXTENSIONS).not.toContain('jxl');
    expect(IMAGE_EXTENSIONS).not.toContain('svg');
    expect(new Set(IMAGE_EXTENSIONS).size).toBe(IMAGE_EXTENSIONS.length);
    // A file dialog's filter for pictures alone (the wallpapers' Import…, Part 6).
    expect(IMAGE_FILE_FILTER.extensions).toEqual(IMAGE_EXTENSIONS);
  });

  it('is what every way in takes: the import, the drop folder, a folder playlist’s order, a Dropbox folder', () => {
    const importable = importableExtensions();
    for (const ext of IMAGE_EXTENSIONS) {
      expect(mediaKindOf(`Placeholder photo.${ext.toUpperCase()}`), ext).toBe('image');
      expect(importable, ext).toContain(ext);
      // In a folder playlist's order, with the pictures (after decks and presentations, before sounds).
      expect(kindRank(`/folder/Placeholder photo.${ext}`), ext).toBe(
        kindRank('/folder/Placeholder photo.jpg'),
      );
      // A Dropbox folder's pictures wait to be added with one button.
      expect(waitingKind(`Placeholder photo.${ext}`), ext).toBe(true);
      // Served to Drashti's own windows as a picture of its type, never a bare stream of bytes.
      expect(contentTypeOf(`/Media/ab/abcd.${ext}`), ext).toMatch(/^image\//u);
    }
    expect(contentTypeOf('x.jfif')).toBe('image/jpeg');
    expect(contentTypeOf('x.pjp')).toBe('image/jpeg');
    expect(contentTypeOf('x.apng')).toBe('image/apng');
    expect(contentTypeOf('x.ico')).toBe('image/x-icon');
    // A phone's file picker asks for every picture.
    expect(ADD_ACCEPT.split(',')).toContain('image/*');
  });

  it('says which a screen shows as they are, and which are converted at import', () => {
    for (const ext of [
      'jpg',
      'jpeg',
      'jfif',
      'jpe',
      'pjpeg',
      'pjp',
      'png',
      'apng',
      'gif',
      'bmp',
      'webp',
      'avif',
      'ico',
    ])
      expect(imageShownAsIs(ext), ext).toBe(true);
    for (const ext of ['tif', 'tiff', 'heic', 'heif', 'tga', 'psd', 'jp2', 'j2k'])
      expect(imageShownAsIs(ext), ext).toBe(false);
    // A sharpened copy of a JPEG by another name is a JPEG too.
    expect(copyExtOf('/Media/ab/abcd.jfif')).toBe('jpg');
    expect(copyExtOf('/Media/ab/abcd.pjpeg')).toBe('jpg');
    expect(copyExtOf('/Media/ab/abcd.ico')).toBe('png');
  });

  it('knows the new kinds by their first bytes, whatever they are called', async () => {
    expect(await probeMedia(file('icon.ico', ICO))).toEqual({
      playable: true,
      format: 'ICO icon',
      kind: 'image',
    });
    expect(await probeMedia(file('flyer.psd', PSD))).toEqual({
      playable: false,
      format: 'Photoshop picture (PSD)',
      kind: 'image',
    });
    for (const [name, bytes] of [
      ['scan.jp2', JP2],
      ['scan.j2k', J2K],
    ] as const)
      expect(await probeMedia(file(name, bytes)), name).toEqual({
        playable: false,
        format: 'JPEG 2000 picture',
        kind: 'image',
      });
    // A JPEG called .jfif is a JPEG.
    expect(await probeMedia(file('download.jfif', JPEG))).toMatchObject({ playable: true, kind: 'image' });
    // From a phone, each by what is inside it.
    expect(await whatFileIs(file('IMG_0002', ICO))).toEqual({ kind: 'image', ext: 'ico' });
    expect(await whatFileIs(file('IMG_0003', PSD))).toEqual({ kind: 'image', ext: 'psd' });
    expect(await whatFileIs(file('IMG_0004', JP2))).toEqual({ kind: 'image', ext: 'jp2' });
    expect(await whatFileIs(file('IMG_0005', J2K))).toEqual({ kind: 'image', ext: 'j2k' });
  });
});
