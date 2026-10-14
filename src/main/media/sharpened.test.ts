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
import type { CopyWant, SharpenJob } from './sharpened';
import { removeCopiesOf, SHARPENED_DIR, SharpenedCopies } from './sharpened';

/*
 * Sharpened copies (Session 26f): made once per picture whose Sharpness is above 0, made again when it
 * changes, removed with the picture, never made from or into the picture's own file; until one is ready
 * the picture shows unsharpened. The hidden window is played here by the test.
 */

const SHA_A = 'aa'.repeat(32);
const SHA_B = 'bb'.repeat(32);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'drashti-sharpened-'));
  mkdirSync(join(dir, 'aa'), { recursive: true });
  mkdirSync(join(dir, 'bb'), { recursive: true });
  // The pictures' own files (what they hold does not matter here: the window is the test's).
  writeFileSync(join(dir, 'aa', `${SHA_A}.jpg`), 'placeholder picture A');
  writeFileSync(join(dir, 'bb', `${SHA_B}.png`), 'placeholder picture B');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const jpeg = (fill: number) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, fill, fill, 0xff, 0xd9]);
const png = (fill: number) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, fill]);

/** A library and the hidden window, as the service sees them. */
function setUp(wanted: CopyWant[]) {
  const log: string[] = [];
  const windows = { opened: 0, destroyed: 0, id: 0 };
  let changed = 0;
  const jobs: SharpenJob[] = [];
  const library = { wanted };
  const copies = new SharpenedCopies({
    mediaDir: dir,
    wanted: () => library.wanted,
    open: () => {
      windows.opened++;
      windows.id++;
      const id = windows.id;
      return {
        id,
        destroy: () => {
          windows.destroyed++;
        },
      };
    },
    changed: () => {
      changed++;
    },
    log: (m) => log.push(m),
  });
  /** The window makes every copy asked for: `make` gives its bytes (null: it could not). */
  const drain = async (
    make: (job: SharpenJob) => Uint8Array | null = (j) =>
      j.type === 'image/jpeg' ? jpeg(j.percent) : png(j.percent),
  ) => {
    for (let job = await copies.next(windows.id); job; job = await copies.next(windows.id)) {
      jobs.push(job);
      await copies.made(windows.id, job.key, make(job));
    }
    await copies.idle();
  };
  return { copies, library, windows, jobs, drain, log, changed: () => changed };
}

const A = (sharpness: number): CopyWant => ({
  mediaId: 'media-a',
  sha256: SHA_A,
  path: `aa/${SHA_A}.jpg`,
  sharpness,
});
const B = (sharpness: number): CopyWant => ({
  mediaId: 'media-b',
  sha256: SHA_B,
  path: `bb/${SHA_B}.png`,
  sharpness,
});

const copiesOnDisk = () =>
  existsSync(join(dir, SHARPENED_DIR)) ? readdirSync(join(dir, SHARPENED_DIR)).sort() : [];

describe('sharpened copies', () => {
  it('are made once per picture with Sharpness above 0, at its step, from its own file and into their own', async () => {
    const t = setUp([A(0.5), B(0.33)]);
    // Until a copy is ready, the picture is drawn unsharpened: no copy to name.
    expect(t.copies.readyStep(SHA_A)).toBe(0);
    expect(t.copies.relativePath(SHA_A, 50)).toBeNull();
    await t.copies.refresh();
    expect(t.windows.opened).toBe(1);
    await t.drain();
    // The window was given each picture's own bytes, the kernel's percent, and asked for its kind of file.
    expect(t.jobs.map((j) => [Buffer.from(j.data).toString(), j.percent, j.type])).toEqual([
      ['placeholder picture A', 50, 'image/jpeg'],
      ['placeholder picture B', 35, 'image/png'],
    ]);
    expect(copiesOnDisk()).toEqual([`${SHA_A}-50.jpg`, `${SHA_B}-35.png`]);
    expect(t.copies.readyStep(SHA_A)).toBe(50);
    expect(t.copies.relativePath(SHA_A, 50)).toBe(`${SHARPENED_DIR}/${SHA_A}-50.jpg`);
    expect(t.copies.relativePath(SHA_A, 55)).toBeNull();
    expect(new Uint8Array(readFileSync(join(dir, SHARPENED_DIR, `${SHA_A}-50.jpg`)))).toEqual(jpeg(50));
    // A node copies it by its own hash.
    expect(t.copies.fileOf(SHA_A, 50)).toMatchObject({ bytes: 8, ext: 'jpg' });
    // The pictures' own files are as they were.
    expect(readFileSync(join(dir, 'aa', `${SHA_A}.jpg`), 'utf8')).toBe('placeholder picture A');
    expect(readFileSync(join(dir, 'bb', `${SHA_B}.png`), 'utf8')).toBe('placeholder picture B');
    expect(t.changed()).toBe(2);
    // The window goes once nothing is left.
    expect(t.windows.destroyed).toBe(1);
    // Once: looking again (or Drashti starting again) makes nothing.
    await t.copies.refresh();
    expect(t.windows.opened).toBe(1);
    const again = setUp([A(0.5), B(0.33)]);
    await again.copies.refresh();
    await again.copies.idle();
    expect(again.windows.opened).toBe(0);
    expect(again.copies.readyStep(SHA_B)).toBe(35);
    // Its hash worked out by then (a node copies it by it), and no file left open.
    expect(again.copies.fileOf(SHA_B, 35)).toMatchObject({ bytes: 9, ext: 'png' });
  });

  it('are made again when Sharpness changes, and go when it is back at 0', async () => {
    const t = setUp([A(0.5)]);
    await t.copies.refresh();
    await t.drain();
    t.library.wanted = [A(0.8)];
    await t.copies.refresh();
    // The old one is gone at once (the picture shows unsharpened until the new one is ready).
    expect(t.copies.readyStep(SHA_A)).toBe(0);
    expect(copiesOnDisk()).toEqual([]);
    await t.drain();
    expect(copiesOnDisk()).toEqual([`${SHA_A}-80.jpg`]);
    expect(t.copies.readyStep(SHA_A)).toBe(80);
    // A move or a brightness change keeps the same sharpness step: nothing to make.
    t.library.wanted = [A(0.79)];
    await t.copies.refresh();
    expect(t.windows.opened).toBe(2);
    t.library.wanted = [A(0)];
    await t.copies.refresh();
    expect(copiesOnDisk()).toEqual([]);
    expect(t.copies.readyStep(SHA_A)).toBe(0);
  });

  it('are removed with the picture', async () => {
    const t = setUp([A(0.5), B(0.5)]);
    await t.copies.refresh();
    await t.drain();
    expect(copiesOnDisk()).toHaveLength(2);
    // Deleted for good (Drashti started again): the library no longer lists it.
    t.library.wanted = [B(0.5)];
    await t.copies.refresh();
    expect(copiesOnDisk()).toEqual([`${SHA_B}-50.png`]);
    expect(t.copies.readyStep(SHA_A)).toBe(0);
    // And the purge removes a picture's copies itself, whatever their step.
    await removeCopiesOf(dir, SHA_B);
    expect(copiesOnDisk()).toEqual([]);
  });

  it('throw away a copy that came back after its picture changed, and a half-written one', async () => {
    const t = setUp([A(0.5)]);
    await t.copies.refresh();
    const job = await t.copies.next(t.windows.id);
    if (!job) throw new Error('a job expected');
    t.library.wanted = [A(0.6)];
    await t.copies.made(t.windows.id, job.key, jpeg(1));
    expect(copiesOnDisk()).toEqual([]);
    await t.copies.refresh();
    await t.drain();
    expect(copiesOnDisk()).toEqual([`${SHA_A}-60.jpg`]);
    writeFileSync(join(dir, SHARPENED_DIR, `${SHA_A}-60.jpg.part-x`), 'half');
    writeFileSync(join(dir, SHARPENED_DIR, `${SHA_B}-50.png`), 'nothing wants this');
    await t.copies.refresh();
    expect(copiesOnDisk()).toEqual([`${SHA_A}-60.jpg`]);
  });

  it('leave the picture unsharpened when one cannot be made, and do not try it again until its look changes', async () => {
    const t = setUp([A(0.5)]);
    await t.copies.refresh();
    await t.drain(() => null);
    expect(t.copies.readyStep(SHA_A)).toBe(0);
    expect(copiesOnDisk()).toEqual([]);
    expect(t.log.some((l) => l.includes('could not be made'))).toBe(true);
    await t.copies.refresh();
    expect(t.windows.opened).toBe(1);
    // Not what was asked for (a PNG for a JPEG copy): refused as well.
    t.library.wanted = [A(0.7)];
    await t.copies.refresh();
    await t.drain(() => png(1));
    expect(t.copies.readyStep(SHA_A)).toBe(0);
    t.library.wanted = [A(0.9)];
    await t.copies.refresh();
    await t.drain();
    expect(t.copies.readyStep(SHA_A)).toBe(90);
  });

  it('answer only their own window, and skip a picture whose file is missing', async () => {
    const t = setUp([{ ...A(0.5), path: 'aa/not-there.jpg' }, B(0.5)]);
    await t.copies.refresh();
    expect(await t.copies.next(t.windows.id + 1)).toBeNull();
    const job = await t.copies.next(t.windows.id);
    expect(job?.type).toBe('image/png');
    if (!job) throw new Error('a job expected');
    expect(await t.copies.made(t.windows.id + 1, job.key, png(1))).toBe(false);
    expect(await t.copies.made(t.windows.id, 'another key', png(1))).toBe(false);
    expect(await t.copies.made(t.windows.id, job.key, png(1))).toBe(true);
    await t.copies.idle();
    expect(copiesOnDisk()).toEqual([`${SHA_B}-50.png`]);
  });
});
