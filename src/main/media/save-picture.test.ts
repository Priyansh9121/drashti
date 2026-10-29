import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PLAIN } from '../../shared/picture-look';
import { editFilters, savedName, savePicture, savePictureArgs, savesAsJpeg } from './save-picture';

/*
 * Save picture… (Session 55, Part 5): full size where the operator chooses, "<name>.jpg" for a photo and
 * "<name>.png" for anything else, turned, flipped and cropped as it shows; FFmpeg stood in for here.
 */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-save-picture-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('Save picture… (Session 55, Part 5)', () => {
  it('names the file by the picture, or by the deck’s slide, as a JPEG for a photo and a PNG for anything else', () => {
    expect(savedName('Placeholder darshan.heic', true)).toBe('Placeholder darshan.jpg');
    expect(savedName('Placeholder deck_3', false)).toBe('Placeholder deck_3.png');
    expect(savedName('Screenshot 2026-10-30 at 07.40.12.PNG', false)).toBe(
      'Screenshot 2026-10-30 at 07.40.12.png',
    );
    expect(savedName('a/b\\c:d*e?"f<g>h|i', false)).toBe('a b c d e f g h i.png');
    expect(savedName('   ', true)).toBe('Picture.jpg');
    expect(savedName('Trailing dots...', false)).toBe('Trailing dots.png');
    expect(savedName('ગુજરાતી ચિત્ર.jpg', true)).toBe('ગુજરાતી ચિત્ર.jpg');
    expect(savesAsJpeg('jpg')).toBe(true);
    expect(savesAsJpeg('JFIF')).toBe(true);
    for (const ext of ['png', 'webp', 'gif', 'bmp', 'avif', 'ico']) expect(savesAsJpeg(ext), ext).toBe(false);
  });

  it('turns, flips and crops as the screens draw it: turned, then flipped as it shows, then the part kept', () => {
    expect(editFilters(null)).toBe('');
    expect(editFilters({ ...PLAIN, brightness: 0.2, sharpness: 0.5 })).toBe('');
    expect(editFilters({ ...PLAIN, turn: 90 })).toBe('transpose=clock');
    expect(editFilters({ ...PLAIN, turn: 180, flipX: true })).toBe('hflip,vflip,hflip');
    expect(editFilters({ ...PLAIN, turn: 270, flipY: true, crop: { x: 0.25, y: 0, w: 0.5, h: 1 } })).toBe(
      'transpose=cclock,vflip,crop=w=floor(iw*0.5):h=floor(ih*1):x=floor(iw*0.25):y=floor(ih*0)',
    );
    const args = savePictureArgs('/Media/aa/p.jpg', '/Pictures/.part.jpg', { ...PLAIN, turn: 90 }, true);
    expect(args.slice(args.indexOf('-i'), args.indexOf('-i') + 2)).toEqual(['-i', '/Media/aa/p.jpg']);
    expect(args.slice(args.indexOf('-vf'), args.indexOf('-vf') + 2)).toEqual(['-vf', 'transpose=clock']);
    expect(args).toContain('-q:v');
    expect(args.at(-1)).toBe('/Pictures/.part.jpg');
    // A PNG: no quality, no filter when nothing changes it.
    const png = savePictureArgs('/Media/bb/p.webp', '/Pictures/.part.png', null, false);
    expect(png).not.toContain('-vf');
    expect(png).not.toContain('-q:v');
  });

  it('copies a JPEG or a PNG as it is when nothing turns, flips or crops it; makes anything else with FFmpeg', async () => {
    const runs: string[][] = [];
    const run = (args: string[]) => {
      runs.push(args);
      writeFileSync(args.at(-1) ?? '', 'made by FFmpeg');
      return Promise.resolve(true);
    };
    const photo = join(dir, 'photo.jpg');
    writeFileSync(photo, 'placeholder jpeg bytes');
    expect(
      await savePicture(photo, 'jpg', join(dir, 'Saved.jpg'), { ...PLAIN, brightness: 0.3 }, run),
    ).toEqual({
      ok: true,
    });
    expect(readFileSync(join(dir, 'Saved.jpg'), 'utf8')).toBe('placeholder jpeg bytes');
    expect(runs).toEqual([]);
    // Cropped: made by FFmpeg, full size.
    expect(
      await savePicture(
        photo,
        'jpg',
        join(dir, 'Cropped.jpg'),
        { ...PLAIN, crop: { x: 0, y: 0, w: 0.5, h: 1 } },
        run,
      ),
    ).toEqual({ ok: true });
    expect(readFileSync(join(dir, 'Cropped.jpg'), 'utf8')).toBe('made by FFmpeg');
    // A WebP: made a PNG.
    const webp = join(dir, 'sticker.webp');
    writeFileSync(webp, 'placeholder webp');
    expect(await savePicture(webp, 'webp', join(dir, 'Sticker.png'), null, run)).toEqual({ ok: true });
    expect(runs.at(-1)?.at(-1)).toMatch(/\.png$/u);
    // Nothing half-made is left beside them.
    expect(readdirSync(dir).filter((n) => n.startsWith('.drashti-'))).toEqual([]);
  });

  it('says so when it cannot be made or saved, leaving nothing there', async () => {
    const webp = join(dir, 'sticker.webp');
    writeFileSync(webp, 'placeholder webp');
    expect(
      await savePicture(webp, 'webp', join(dir, 'Sticker.png'), null, () => Promise.resolve(false)),
    ).toEqual({
      ok: false,
      message: 'Drashti could not make this picture: it could not be read.',
    });
    expect(existsSync(join(dir, 'Sticker.png'))).toBe(false);
    const gone = await savePicture(join(dir, 'gone.png'), 'png', join(dir, 'Gone.png'), null, () =>
      Promise.resolve(true),
    );
    expect(gone.ok).toBe(false);
    expect(readdirSync(dir)).toEqual(['sticker.webp']);
  });
});
