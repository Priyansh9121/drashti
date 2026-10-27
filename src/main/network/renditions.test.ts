import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PICTURE_WIDTHS, pictureStep } from '../../shared/device-pictures';
import { ffmpegHere } from '../testing/ffmpeg-here';
import { readPictureInfo } from './picture-info';
import { renditionArgs, RenditionMaker, type RenditionRun, RENDITIONS_KEEP_FREE_BYTES } from './renditions';

/*
 * Pictures for phones and tablets at the width they draw them (Session 54, D1): the steps, the file itself where
 * a browser shows it and it is no wider than asked, a step made once and kept, a see-through picture kept so, and
 * the folder held to its size. FFmpeg is stood in for by a run that writes a file of a given size; headers are
 * made here.
 */

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-renditions-'));
  mkdirSync(join(dir, 'media'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A PNG's headers saying this size (and alpha, colour type 6); enough for the size to be read. */
function pngFile(name: string, width: number, height: number, alpha = false): string {
  const b = Buffer.alloc(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[24] = 8;
  b[25] = alpha ? 6 : 2;
  b.writeUInt32BE(10, 33);
  b.write('IDAT', 37, 'latin1');
  const file = join(dir, 'media', name);
  writeFileSync(file, b);
  return file;
}

/** A stand-in for FFmpeg: writes `bytes` bytes where it is told, and remembers what it was asked. */
function fakeRun(bytes = 1000): RenditionRun & { calls: string[][] } {
  const calls: string[][] = [];
  const run = (args: string[]) => {
    calls.push(args);
    const out = args.at(-1);
    if (out) writeFileSync(out, Buffer.alloc(bytes, 1));
    return Promise.resolve(bytes > 0);
  };
  return Object.assign(run, { calls });
}

describe('the steps a picture is made at (Session 54, D1)', () => {
  it('asks for the smallest step at least as wide as the picture is drawn', () => {
    expect(pictureStep(1)).toBe(320);
    expect(pictureStep(320)).toBe(320);
    expect(pictureStep(321)).toBe(640);
    // A slide's thumbnail on a phone (165 CSS pixels at 3 device pixels each); the live picture (343 at 3).
    expect(pictureStep(495)).toBe(640);
    expect(pictureStep(1029)).toBe(1280);
    // Zoomed four times: as wide as there is.
    expect(pictureStep(4500)).toBe(7680);
    expect(pictureStep(100_000)).toBe(7680);
    expect(pictureStep(Number.NaN)).toBe(320);
    expect(pictureStep(-5)).toBe(320);
    expect([...PICTURE_WIDTHS].sort((a, b) => a - b)).toEqual([...PICTURE_WIDTHS]);
  });

  it('never makes a picture wider than it is, turned as it is shown, and only from a file', () => {
    const args = renditionArgs({ path: '/media/a.jpg', kind: 'image' }, 1280, '/out/a-1280.part.jpg');
    expect(args).toContain("scale=w='min(iw,1280)':h=-1:flags=lanczos,setsar=1");
    expect(args.slice(args.indexOf('-protocol_whitelist'), args.indexOf('-protocol_whitelist') + 2)).toEqual([
      '-protocol_whitelist',
      'file',
    ]);
    // FFmpeg turns a photo by its EXIF orientation itself: nothing here asks it not to.
    expect(args).not.toContain('-noautorotate');
    expect(args).toContain('-q:v');
    // A video's frame from half a second in; a PNG keeps its alpha (no JPEG quality setting).
    expect(renditionArgs({ path: '/media/v.mp4', kind: 'video' }, 640, '/out/v.part.jpg')).toContain('-ss');
    expect(renditionArgs({ path: '/media/p.png', kind: 'image' }, 640, '/out/p.part.png')).not.toContain(
      '-q:v',
    );
  });
});

describe('making and keeping pictures for devices (Session 54, D1)', () => {
  it('gives the file itself when a browser shows it and it is no wider than asked', async () => {
    const run = fakeRun();
    const maker = new RenditionMaker(join(dir, 'sized'), null, { run });
    const source = { path: pngFile('small.png', 1200, 675), kind: 'image' as const };
    expect(await maker.get('pic-1', source, 1100)).toEqual({
      file: source.path,
      type: 'image/png',
      original: true,
    });
    expect(await maker.get('pic-1', source, 7680)).toMatchObject({ original: true });
    expect(run.calls).toEqual([]);
    // Wider than asked: made smaller, once, and the same file given each time after.
    const made = await maker.get('pic-1', source, 600);
    expect(made).toMatchObject({ type: 'image/jpeg', original: false });
    expect(made?.file).toMatch(/pic-1-640-[0-9a-z]+-[0-9a-z]+\.jpg$/u);
    expect(existsSync(made?.file ?? '')).toBe(true);
    expect(await maker.get('pic-1', source, 500)).toEqual(made);
    expect(run.calls).toHaveLength(1);
    // Asked twice at once: made once.
    const big = { path: pngFile('big.png', 4000, 2250), kind: 'image' as const };
    const [one, two] = await Promise.all([maker.get('pic-2', big, 1000), maker.get('pic-2', big, 1100)]);
    expect(one).toMatchObject({ original: false });
    expect(one).toEqual(two);
    expect(run.calls).toHaveLength(2);
    // Nothing half made is left.
    expect(readdirSync(join(dir, 'sized')).filter((n) => n.includes('.part.'))).toEqual([]);
  });

  it('keeps a see-through picture see-through, and makes a video’s frame', async () => {
    const run = fakeRun();
    const maker = new RenditionMaker(join(dir, 'sized'), null, { run });
    const glass = { path: pngFile('glass.png', 3000, 2000, true), kind: 'image' as const };
    expect(await maker.get('glass', glass, 1280)).toMatchObject({ type: 'image/png', original: false });
    const video = join(dir, 'media', 'clip.mp4');
    writeFileSync(video, Buffer.alloc(2000, 7));
    // A video is never served as a picture: its frame, at the width asked.
    expect(await maker.get('clip', { path: video, kind: 'video' }, 7680)).toMatchObject({
      type: 'image/jpeg',
      original: false,
    });
    expect(run.calls.at(-1)).toContain('-ss');
  });

  it('makes a picture again when its file changes, and never keeps a step FFmpeg could not make', async () => {
    const run = fakeRun();
    const maker = new RenditionMaker(join(dir, 'sized'), null, { run });
    const path = pngFile('changes.png', 4000, 2250);
    const before = await maker.get('changes', { path, kind: 'image' }, 1280);
    // The same name, another file (a later time): a step of its own.
    utimesSync(path, new Date(2_000_000_000_000), new Date(2_000_000_000_000));
    const after = await maker.get('changes', { path, kind: 'image' }, 1280);
    expect(after?.file).not.toBe(before?.file);
    const failing = new RenditionMaker(join(dir, 'sized-2'), null, { run: fakeRun(0) });
    expect(await failing.get('changes', { path, kind: 'image' }, 640)).toBeNull();
    expect(existsSync(join(dir, 'sized-2')) ? readdirSync(join(dir, 'sized-2')) : []).toEqual([]);
    // Without FFmpeg, only what needs none.
    const none = new RenditionMaker(join(dir, 'sized-3'), null);
    expect(await none.get('changes', { path, kind: 'image' }, 640)).toBeNull();
    expect(await none.get('changes', { path, kind: 'image' }, 7680)).toMatchObject({ original: true });
    // A file that is not there.
    expect(await none.get('gone', { path: join(dir, 'media', 'gone.png'), kind: 'image' }, 640)).toBeNull();
    // A disk with less than 2 GB free: nothing made (the phone keeps what it has), the file itself still given.
    const full = new RenditionMaker(join(dir, 'sized-4'), null, {
      run: fakeRun(),
      freeBytes: () => Promise.resolve(RENDITIONS_KEEP_FREE_BYTES - 1),
    });
    expect(await full.get('changes', { path, kind: 'image' }, 640)).toBeNull();
    expect(await full.get('changes', { path, kind: 'image' }, 7680)).toMatchObject({ original: true });
  });

  it('holds the folder to its size, the least recently used going first', async () => {
    const run = fakeRun(400);
    const sized = join(dir, 'sized');
    let clock = 1_000_000;
    const now = () => (clock += 1000);
    const maker = new RenditionMaker(sized, null, { run, maxBytes: 1000, now });
    const a = { path: pngFile('a.png', 4000, 2250), kind: 'image' as const };
    const b = { path: pngFile('b.png', 4000, 2250), kind: 'image' as const };
    const c = { path: pngFile('c.png', 4000, 2250), kind: 'image' as const };
    const first = await maker.get('a', a, 640);
    const second = await maker.get('b', b, 640);
    // The first used again: the second is now the least recently used, and goes when the third is made.
    await maker.get('a', a, 640);
    const third = await maker.get('c', c, 640);
    expect(existsSync(first?.file ?? '')).toBe(true);
    expect(existsSync(third?.file ?? '')).toBe(true);
    expect(existsSync(second?.file ?? '')).toBe(false);
    const total = readdirSync(sized).reduce((sum, n) => sum + statSync(join(sized, n)).size, 0);
    expect(total).toBeLessThanOrEqual(1000);
    // A new start reads the folder again: what is there is used, never made again.
    const again = new RenditionMaker(sized, null, { run, maxBytes: 1000, now });
    const calls = run.calls.length;
    expect(await again.get('c', c, 640)).toEqual(third);
    expect(run.calls.length).toBe(calls);
  });
});

const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffmpeg = join(process.cwd(), 'vendor', 'ffmpeg', `${process.platform}-${process.arch}`, exe);

/** FFmpeg's own test picture or clip, made here. */
function make(args: string[]): void {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
}

/** The same JPEG with an EXIF orientation of 6 (turned a quarter clockwise, as a phone's upright photo is). */
function turned(file: string, out: string): string {
  const jpg = readFileSync(file);
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(6, 18);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  writeFileSync(out, Buffer.concat([jpg.subarray(0, 2), head, payload, jpg.subarray(2)]));
  return out;
}

describe.skipIf(!ffmpegHere(ffmpeg))('pictures made smaller by the bundled FFmpeg (Session 54, D1)', () => {
  it('makes a step as wide as asked, a photo turned as it is shown, a see-through picture so, and a video’s frame', async () => {
    const media = join(dir, 'media');
    const maker = new RenditionMaker(join(dir, 'sized'), ffmpeg);
    const photo = join(media, 'photo.jpg');
    make(['-f', 'lavfi', '-i', 'testsrc2=s=1600x900', '-frames:v', '1', photo]);
    const wide = await maker.get('photo', { path: photo, kind: 'image' }, 600);
    expect(wide).toMatchObject({ type: 'image/jpeg', original: false });
    expect(await readPictureInfo(wide?.file ?? '')).toMatchObject({
      format: 'jpeg',
      width: 640,
      height: 360,
    });
    // Upright on a phone: 900 wide as shown, so 320 wide and taller than wide.
    const upright = turned(photo, join(media, 'upright.jpg'));
    expect(await readPictureInfo(upright)).toMatchObject({ width: 900, height: 1600 });
    const small = await maker.get('upright', { path: upright, kind: 'image' }, 300);
    expect(await readPictureInfo(small?.file ?? '')).toMatchObject({ width: 320, height: 569 });
    // Half see-through: a PNG still, its alpha kept.
    const glass = join(media, 'glass.png');
    make(['-f', 'lavfi', '-i', 'color=c=red@0.5:s=800x600,format=rgba', '-frames:v', '1', glass]);
    const kept = await maker.get('glass', { path: glass, kind: 'image' }, 320);
    expect(kept).toMatchObject({ type: 'image/png', original: false });
    expect(await readPictureInfo(kept?.file ?? '')).toMatchObject({ format: 'png', width: 320, alpha: true });
    // A video's frame, at the width asked.
    const clip = join(media, 'clip.mp4');
    make(['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=10', '-t', '1', '-pix_fmt', 'yuv420p', clip]);
    const frame = await maker.get('clip', { path: clip, kind: 'video' }, 640);
    expect(await readPictureInfo(frame?.file ?? '')).toMatchObject({
      format: 'jpeg',
      width: 640,
      height: 360,
    });
  }, 60_000);
});
