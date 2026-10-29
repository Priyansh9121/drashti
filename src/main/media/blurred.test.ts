import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BLUR_SIDE, BLURRED_DIR, BlurredCopies, blurArgs, removeBlurredOf } from './blurred';

/*
 * Blurred copies (Session 55, Part 5, D): made once per picture by FFmpeg (stood in for here), small and already
 * blurred, when a picture is imported or first comes up; never while on air; kept beside the sharpened copies.
 */

const SHA_A = 'aa'.repeat(32);
const SHA_B = 'bb'.repeat(32);
const COPY = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-blurred-'));
  mkdirSync(join(dir, 'aa'), { recursive: true });
  mkdirSync(join(dir, 'bb'), { recursive: true });
  writeFileSync(join(dir, 'aa', `${SHA_A}.jpg`), 'placeholder photo A');
  writeFileSync(join(dir, 'bb', `${SHA_B}.png`), 'placeholder photo B');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const FILES: Record<string, { sha256: string; path: string }> = {
  a: { sha256: SHA_A, path: `aa/${SHA_A}.jpg` },
  b: { sha256: SHA_B, path: `bb/${SHA_B}.png` },
  missing: { sha256: 'cc'.repeat(32), path: `cc/${'cc'.repeat(32)}.jpg` },
};

function setUp(options: { fail?: boolean } = {}) {
  const runs: string[][] = [];
  const air = { on: false };
  let changed = 0;
  const log: string[] = [];
  const copies = new BlurredCopies({
    mediaDir: dir,
    fileOf: (id) => FILES[id] ?? null,
    // FFmpeg, stood in for: the copy written where it was asked for (its last argument).
    run: (args) => {
      runs.push(args);
      if (options.fail) return Promise.resolve(false);
      writeFileSync(args.at(-1) ?? '', COPY);
      return Promise.resolve(true);
    },
    onAir: () => air.on,
    changed: () => {
      changed++;
    },
    log: (m) => log.push(m),
    retryMs: 5,
  });
  return { copies, runs, air, changed: () => changed, log };
}

const onDisk = () => (existsSync(join(dir, BLURRED_DIR)) ? readdirSync(join(dir, BLURRED_DIR)).sort() : []);

describe('blurred copies (Session 55, Part 5, D)', () => {
  it('are made by FFmpeg small, blurred and darker, from the picture turned as its EXIF says', () => {
    const args = blurArgs('/Media/aa/a.jpg', '/Media/blurred/a.jpg.part');
    expect(args.slice(args.indexOf('-i'), args.indexOf('-i') + 2)).toEqual(['-i', '/Media/aa/a.jpg']);
    expect(args.at(-1)).toBe('/Media/blurred/a.jpg.part');
    expect(args).toContain('-frames:v');
    const filter = args[args.indexOf('-vf') + 1] ?? '';
    expect(filter).toContain(
      `scale=w=${String(BLUR_SIDE)}:h=${String(BLUR_SIDE)}:force_original_aspect_ratio=decrease`,
    );
    expect(filter).toContain('gblur');
    expect(filter).toContain('colorchannelmixer=rr=0.55:gg=0.55:bb=0.55');
    // Never anything but files (as every FFmpeg Drashti runs).
    expect(args.slice(args.indexOf('-protocol_whitelist'), args.indexOf('-protocol_whitelist') + 2)).toEqual([
      '-protocol_whitelist',
      'file',
    ]);
  });

  it('are made once per picture when wanted, one at a time, and said ready', async () => {
    const t = setUp();
    t.copies.want(['a', 'b', 'a', 'missing', 'no-such-picture']);
    await t.copies.idle();
    // The missing file is never given to FFmpeg: no copy, nothing half-written left.
    expect(t.runs.map((a) => a[a.indexOf('-i') + 1])).toEqual([
      join(dir, 'aa', `${SHA_A}.jpg`),
      join(dir, 'bb', `${SHA_B}.png`),
    ]);
    expect(onDisk()).toEqual([`${SHA_A}.jpg`, `${SHA_B}.jpg`]);
    expect(t.copies.has(SHA_A)).toBe(true);
    expect(t.copies.relativePath(SHA_B)).toBe(`${BLURRED_DIR}/${SHA_B}.jpg`);
    expect(t.copies.relativePath('cc'.repeat(32))).toBeNull();
    expect(t.copies.fileOf(SHA_A)).toEqual({
      hash: createHash('sha256').update(COPY).digest('hex'),
      bytes: COPY.length,
    });
    expect(t.changed()).toBe(2);
    // Wanted again: nothing more is made.
    t.copies.want(['a', 'b', 'missing']);
    await t.copies.idle();
    expect(t.runs).toHaveLength(2);
  });

  it('wait while the stream is on air or recording, then are made', async () => {
    const t = setUp();
    t.air.on = true;
    t.copies.want(['a']);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(t.runs).toHaveLength(0);
    t.air.on = false;
    await t.copies.idle();
    expect(onDisk()).toEqual([`${SHA_A}.jpg`]);
  });

  it('leave the picture on black when one cannot be made, and do not try it again', async () => {
    const t = setUp({ fail: true });
    t.copies.want(['a']);
    await t.copies.idle();
    t.copies.want(['a']);
    await t.copies.idle();
    expect(t.runs).toHaveLength(1);
    expect(onDisk()).toEqual([]);
    expect(t.copies.has(SHA_A)).toBe(false);
    expect(t.log.some((l) => l.startsWith('Blurred copies: one was not made'))).toBe(true);
  });

  it('are found again after a restart, a half-written one gone; go with their picture', async () => {
    mkdirSync(join(dir, BLURRED_DIR));
    writeFileSync(join(dir, BLURRED_DIR, `${SHA_A}.jpg`), COPY);
    writeFileSync(join(dir, BLURRED_DIR, `${SHA_B}.jpg.part-1234.jpg`), 'half');
    const t = setUp();
    await t.copies.scan();
    expect(t.copies.has(SHA_A)).toBe(true);
    expect(t.copies.fileOf(SHA_A)?.bytes).toBe(COPY.length);
    expect(onDisk()).toEqual([`${SHA_A}.jpg`]);
    t.copies.want(['a']);
    await t.copies.idle();
    expect(t.runs).toHaveLength(0);
    await removeBlurredOf(dir, SHA_A);
    await removeBlurredOf(dir, '../not-a-hash');
    expect(onDisk()).toEqual([]);
  });
});
