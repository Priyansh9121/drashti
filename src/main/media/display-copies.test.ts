import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import * as displayFileHash from './display-file-hash';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DisplayCopies, type DisplayDeps } from './display-copies';
import { PLAIN } from '../../shared/picture-look';

const SHA = 'aa'.repeat(32);
const png = (width: number, height: number, animated = false) => {
  const head = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(head);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12);
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  head[24] = 8;
  head[25] = 6;
  const chunk = Buffer.alloc(12);
  chunk.write(animated ? 'acTL' : 'IDAT', 4);
  return Buffer.concat([head, chunk]);
};
const dirs: string[] = [];
const services: DisplayCopies[] = [];
afterEach(() => {
  for (const s of services.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function setup(
  bytes = png(6144, 3456),
  free: number | (() => number) = 10 * 1024 ** 3,
  existing?: string,
  runtime: Partial<Pick<DisplayDeps, 'targets' | 'canWork' | 'canStart' | 'held'>> = {},
) {
  const dir = existing ?? mkdtempSync(join(tmpdir(), 'drashti-display-'));
  if (!existing) dirs.push(dir);
  mkdirSync(join(dir, 'aa'), { recursive: true });
  const path = `aa/${SHA}.png`;
  writeFileSync(join(dir, path), bytes);
  const windows = { opened: 0, destroyed: 0 };
  const blobs = new Map<string, Uint8Array>();
  const changed = vi.fn<() => void>();
  const copies = new DisplayCopies({
    mediaDir: dir,
    targets: () => [{ width: 1920, height: 1080 }],
    ...runtime,
    open: () => {
      windows.opened++;
      return {
        id: windows.opened,
        beforeBytes: () => undefined,
        saveBlob: async (blob, destination) => {
          const bytes = blobs.get(blob.url);
          if (bytes?.byteLength !== blob.bytes) throw new Error('Unknown generated Blob');
          await writeFile(destination, bytes);
        },
        destroy: () => {
          windows.destroyed++;
        },
      };
    },
    changed,
    log: () => undefined,
    freeBytes: () => (typeof free === 'number' ? free : free()),
  });
  services.push(copies);
  const made = (sender: number, key: unknown, bytes: Uint8Array | null) => {
    if (bytes === null) return copies.made(sender, key, null);
    const url = `blob:null/${randomUUID()}`;
    blobs.set(url, bytes);
    return copies.made(sender, key, { url, bytes: bytes.byteLength });
  };
  return { dir, copies, windows, changed, made, candidate: { path, sha256: SHA } };
}

describe('original-preserving display copies', () => {
  it('does not announce a new oversized picture ready before its bounded copy is made', async () => {
    const t = setup();
    let finished = false;
    const prepared = t.copies.prepare(t.candidate).then((r) => {
      finished = true;
      return r;
    });
    await vi.waitFor(() => expect(t.windows.opened).toBe(1));
    expect(finished).toBe(false);
    const job = await t.copies.next(1);
    if (!job) throw new Error('The queued copy job was not offered.');
    expect(job).toMatchObject({ box: { width: 1920, height: 1080 }, percent: 0 });
    expect(job).not.toHaveProperty('data');
    const originalSource = t.copies.workerSource(1, job.key);
    if (!originalSource) throw new Error('The owned source was not granted to the worker.');
    expect(new Uint8Array(readFileSync(join(t.dir, originalSource.path)))).toEqual(
      new Uint8Array(png(6144, 3456)),
    );
    const output = png(1920, 1080);
    expect(await t.made(1, job.key, new Uint8Array(output))).toBe(true);
    const result = await prepared;
    expect(result).toMatchObject({
      ok: true,
      copy: { width: 1920, height: 1080, hash: createHash('sha256').update(output).digest('hex') },
    });
    expect(readFileSync(join(t.dir, t.candidate.path))).toEqual(png(6144, 3456));
  });
  it('reuses a checked cache after restart and a duplicate import', async () => {
    const t = setup();
    const first = t.copies.prepare(t.candidate);
    await vi.waitFor(() => expect(t.windows.opened).toBe(1));
    const job = await t.copies.next(1);
    if (!job) throw new Error('The queued copy job was not offered.');
    await t.made(1, job.key, new Uint8Array(png(1920, 1080)));
    const made = await first;
    const again = setup(png(6144, 3456), 10 * 1024 ** 3, t.dir);
    expect(await again.copies.prepare(again.candidate)).toEqual(made);
    expect(again.windows.opened).toBe(0);
    expect(again.changed).toHaveBeenCalledOnce();
  });
  it.each(['deleted', 'damaged'])(
    'withdraws a %s cache file before its replacement is ready',
    async (damage) => {
      const t = setup();
      const first = t.copies.prepare(t.candidate);
      await vi.waitFor(() => expect(t.windows.opened).toBe(1));
      const job = await t.copies.next(1);
      if (!job) throw new Error('The queued copy job was not offered.');
      await t.made(1, job.key, new Uint8Array(png(1920, 1080)));
      const result = await first;
      if (!result.ok || !result.copy) throw new Error('The display file was not made.');
      const idleNext = t.copies.next(1);
      await t.copies.idle();
      const file = join(t.dir, result.copy.path);
      if (damage === 'deleted') rmSync(file);
      else writeFileSync(file, png(320, 180));
      const replacement = t.copies.prepare(t.candidate);
      const replacementJob = await idleNext;
      expect(replacementJob).not.toBeNull();
      expect(t.windows.opened).toBe(1);
      expect(t.copies.ready(SHA)).toBeNull();
      expect(t.copies.relativePath(SHA, job.key)).toBeNull();
      expect(t.changed).toHaveBeenCalledTimes(2);
      t.copies.close();
      expect(await replacement).toMatchObject({ ok: false });
    },
  );
  it('keeps small pictures and animation as their originals, with no copy job', async () => {
    for (const bytes of [png(640, 360), png(6144, 3456, true)]) {
      const t = setup(bytes);
      expect(await t.copies.prepare(t.candidate)).toEqual({ ok: true, copy: null });
      expect(t.windows.opened).toBe(0);
    }
  });
  it('refuses low disk before opening a worker or advertising a copy', async () => {
    const t = setup(png(6144, 3456), 1024);
    expect(await t.copies.prepare(t.candidate)).toMatchObject({ ok: false });
    expect(t.windows.opened).toBe(0);
    expect(t.copies.ready(SHA)).toBeNull();
  });
  it('rejects a wrong-sized worker result rather than advertising it ready', async () => {
    const t = setup();
    const prepared = t.copies.prepare(t.candidate);
    await vi.waitFor(() => expect(t.windows.opened).toBe(1));
    const job = await t.copies.next(1);
    if (!job) throw new Error('The queued copy job was not offered.');
    await t.made(1, job.key, new Uint8Array(png(320, 180)));
    expect(await prepared).toMatchObject({ ok: false });
    expect(t.copies.ready(SHA)).toBeNull();
  });
  it('preserves the show disk reserve if free space falls while a picture is drawn', async () => {
    let free = 10 * 1024 ** 3;
    const t = setup(png(6144, 3456), () => free);
    const prepared = t.copies.prepare(t.candidate);
    await vi.waitFor(() => expect(t.windows.opened).toBe(1));
    const job = await t.copies.next(1);
    if (!job) throw new Error('The queued copy job was not offered.');
    free = 1024;
    await t.made(1, job.key, new Uint8Array(png(1920, 1080)));
    expect(await prepared).toMatchObject({ ok: false });
    expect(t.copies.ready(SHA)).toBeNull();
  });
  it('shares one job for duplicate imports and lets one caller cancel without cancelling the other', async () => {
    const t = setup();
    const abort = new AbortController();
    const first = t.copies.prepare(t.candidate, abort.signal);
    const second = t.copies.prepare(t.candidate);
    await vi.waitFor(() => expect(t.windows.opened).toBe(1));
    const job = await t.copies.next(1);
    if (!job) throw new Error('The queued copy job was not offered.');
    abort.abort();
    expect(await first).toMatchObject({ ok: false });
    expect(t.windows.destroyed).toBe(0);
    await t.made(1, job.key, new Uint8Array(png(1920, 1080)));
    expect(await second).toMatchObject({ ok: true, copy: { width: 1920 } });
    expect(t.windows.opened).toBe(1);
  });
  it('does not start an old-library job during a show, but allows a new import through the same worker', async () => {
    let quiet = false;
    const t = setup(png(6144, 3456), 10 * 1024 ** 3, undefined, { canWork: () => quiet });
    const old = t.copies.prepare(t.candidate, undefined, true);
    await vi.waitFor(() => expect(t.windows.opened).toBe(0));
    const fresh = t.copies.prepare(t.candidate);
    await vi.waitFor(() => expect(t.windows.opened).toBe(1));
    const job = await t.copies.next(1);
    if (!job) throw new Error('The import copy job did not start during the show.');
    await t.made(1, job.key, new Uint8Array(png(1920, 1080)));
    expect(await fresh).toMatchObject({ ok: true });
    expect(await old).toMatchObject({ ok: true });
    quiet = true;
    const idleNext = t.copies.next(1);
    await t.copies.idle();
    expect(t.windows.opened).toBe(1);
    t.copies.close();
    expect(await idleNext).toBeNull();
  });
  it('tells while its queue is held, and once its copy starts (QA22-L8-1, the owner: "Keep wait, say why")', async () => {
    let held = true;
    const told = vi.fn<(waiting: boolean) => void>();
    const t = setup(png(6144, 3456), 10 * 1024 ** 3, undefined, { canStart: () => !held, held: told });
    const prepared = t.copies.prepare(t.candidate);
    await vi.waitFor(() => expect(told).toHaveBeenLastCalledWith(true));
    expect(t.windows.opened).toBe(0);
    held = false;
    t.copies.activityChanged();
    await vi.waitFor(() => expect(t.windows.opened).toBe(1));
    expect(told).toHaveBeenLastCalledWith(false);
    const job = await t.copies.next(1);
    if (!job) throw new Error('The display worker did not start once it was let.');
    await t.made(1, job.key, new Uint8Array(png(1920, 1080)));
    expect(await prepared).toMatchObject({ ok: true });
  });
  it('waits for the other picture worker before starting a decode', async () => {
    let otherWorkerBusy = true;
    const t = setup(png(6144, 3456), 10 * 1024 ** 3, undefined, { canStart: () => !otherWorkerBusy });
    const prepared = t.copies.prepare(t.candidate);
    await vi.waitFor(() => expect(t.windows.opened).toBe(0));
    otherWorkerBusy = false;
    await vi.waitFor(() => {
      t.copies.activityChanged();
      expect(t.windows.opened).toBe(1);
    });
    const job = await t.copies.next(1);
    if (!job) throw new Error('The display worker did not start after sharpening finished.');
    await t.made(1, job.key, new Uint8Array(png(1920, 1080)));
    expect(await prepared).toMatchObject({ ok: true });
  });
  it('retains a checked smaller source while a larger target waits for an idle show', async () => {
    let target = { width: 1920, height: 1080 };
    let quiet = true;
    const t = setup(png(6144, 3456), 10 * 1024 ** 3, undefined, {
      targets: () => [target],
      canWork: () => quiet,
    });
    const first = t.copies.prepare(t.candidate);
    await vi.waitFor(() => expect(t.windows.opened).toBe(1));
    const job = await t.copies.next(1);
    if (!job) throw new Error('The first display copy job did not start.');
    await t.made(1, job.key, new Uint8Array(png(1920, 1080)));
    await first;
    const idleNext = t.copies.next(1);
    await t.copies.idle();
    quiet = false;
    target = { width: 3840, height: 2160 };
    const larger = t.copies.prepare(t.candidate, undefined, true);
    expect(t.copies.ready(SHA)).toMatchObject({ width: 1920, height: 1080 });
    expect(t.windows.opened).toBe(1);
    quiet = true;
    t.copies.activityChanged();
    const next = await idleNext;
    expect(t.windows.opened).toBe(1);
    if (!next) throw new Error('The larger display copy job did not start at idle.');
    expect(next.box).toEqual(target);
    await t.made(1, next.key, new Uint8Array(png(3840, 2160)));
    await larger;
    expect(t.copies.ready(SHA)).toMatchObject(target);
  });
  it('will not read a candidate outside the owned media folder', async () => {
    const t = setup();
    expect(await t.copies.prepare({ ...t.candidate, path: '../outside.png' })).toMatchObject({ ok: false });
    expect(t.windows.opened).toBe(0);
  });
});

describe('asynchronous display checksums', () => {
  async function copyJob(signal?: AbortSignal) {
    const t = setup();
    const prepared = t.copies.prepare(t.candidate, signal);
    await vi.waitFor(() => expect(t.windows.opened).toBe(1));
    const job = await t.copies.next(1);
    if (!job) throw new Error('The checksum test did not receive its copy job.');
    const output = new Uint8Array(png(1920, 1080));
    const hash = createHash('sha256').update(output).digest('hex');
    return { ...t, prepared, job, output, hash };
  }

  it('advertises the same copy only after its asynchronous checksum is complete', async () => {
    const t = await copyJob();
    let finish!: (value: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const digest = vi.spyOn(displayFileHash, 'hashDisplayFile').mockReturnValueOnce(pending);
    const made = t.made(1, t.job.key, t.output);
    try {
      await vi.waitFor(() => expect(digest).toHaveBeenCalledOnce());
      expect(t.copies.ready(SHA)).toBeNull();
      expect(t.changed).not.toHaveBeenCalled();
      const checkedPath = digest.mock.calls[0]?.[0];
      if (!checkedPath) throw new Error('The encoded file was not offered for its checksum.');
      expect(readFileSync(checkedPath)).toEqual(Buffer.from(t.output));
      finish(t.hash);
      expect(await made).toBe(true);
      const result = await t.prepared;
      expect(result).toMatchObject({ ok: true, copy: { hash: t.hash } });
      if (!result.ok || !result.copy) throw new Error('The checked copy was not published.');
      expect(readFileSync(join(t.dir, result.copy.path))).toEqual(Buffer.from(t.output));
      expect(t.changed).toHaveBeenCalledOnce();
    } finally {
      finish(t.hash);
      await made;
      digest.mockRestore();
    }
  });

  it.each(['cancelled', 'closed'])(
    'never publishes a copy %s while its asynchronous checksum is pending',
    async (how) => {
      const abort = new AbortController();
      const t = await copyJob(abort.signal);
      let finish!: (value: string) => void;
      const pending = new Promise<string>((resolve) => {
        finish = resolve;
      });
      const digest = vi.spyOn(displayFileHash, 'hashDisplayFile').mockReturnValueOnce(pending);
      const made = t.made(1, t.job.key, t.output);
      try {
        await vi.waitFor(() => expect(digest).toHaveBeenCalledOnce());
        if (how === 'closed') t.copies.close();
        else abort.abort();
        expect(await t.prepared).toMatchObject({ ok: false });
        finish(t.hash);
        expect(await made).toBe(true);
        expect(t.copies.ready(SHA)).toBeNull();
        expect(t.changed).not.toHaveBeenCalled();
        expect(readdirSync(join(t.dir, 'display'))).toEqual([]);
        expect(readFileSync(join(t.dir, t.candidate.path))).toEqual(png(6144, 3456));
      } finally {
        finish(t.hash);
        await made;
        digest.mockRestore();
      }
    },
  );

  it('refuses a failed checksum without publishing a copy or changing its original', async () => {
    const t = await copyJob();
    const digest = vi
      .spyOn(displayFileHash, 'hashDisplayFile')
      .mockRejectedValueOnce(new Error('Generated asynchronous checksum failure'));
    try {
      expect(await t.made(1, t.job.key, t.output)).toBe(true);
      expect(await t.prepared).toMatchObject({ ok: false });
      expect(t.copies.ready(SHA)).toBeNull();
      expect(t.changed).not.toHaveBeenCalled();
      expect(readdirSync(join(t.dir, 'display'))).toEqual([]);
      expect(readFileSync(join(t.dir, t.candidate.path))).toEqual(png(6144, 3456));
    } finally {
      digest.mockRestore();
    }
  });
});

describe('display look target snapshots', () => {
  const small = [{ width: 1920, height: 1080 }];
  const large = [{ width: 3840, height: 2160 }];

  async function checkedSizes() {
    let current = small;
    const targets = vi.fn(() => current);
    const t = setup(png(6144, 3456), 10 * 1024 ** 3, undefined, { targets });
    const first = t.copies.prepare(t.candidate);
    await vi.waitFor(() => expect(t.windows.opened).toBe(1));
    const a = await t.copies.next(1);
    if (!a) throw new Error('The small checked copy was not offered.');
    await t.made(1, a.key, new Uint8Array(png(1920, 1080)));
    const smallResult = await first;
    const waiting = t.copies.next(1);
    await t.copies.idle();
    current = large;
    const second = t.copies.prepare(t.candidate);
    const b = await waiting;
    if (!b) throw new Error('The large checked copy was not offered.');
    await t.made(1, b.key, new Uint8Array(png(3840, 2160)));
    const largeResult = await second;
    if (!smallResult.ok || !smallResult.copy || !largeResult.ok || !largeResult.copy)
      throw new Error('Both physical target sizes must have checked copies.');
    targets.mockClear();
    return { copies: t.copies, targets, smallCopy: smallResult.copy, largeCopy: largeResult.copy };
  }

  it('does not reread screens and stream context for each look in one supplied target snapshot', async () => {
    const t = await checkedSizes();
    for (let i = 0; i < 10; i++) expect(t.copies.ready(SHA, null, large)).toEqual(t.largeCopy);
    expect(t.targets).not.toHaveBeenCalled();
  });

  it('selects the exact checked copy for each supplied snapshot without retaining it for later calls', async () => {
    const t = await checkedSizes();
    expect(t.copies.ready(SHA, null, small)).toEqual(t.smallCopy);
    expect(t.copies.ready(SHA, null, large)).toEqual(t.largeCopy);
    expect(t.copies.ready(SHA, null, small)).toEqual(t.smallCopy);
    expect(t.targets).not.toHaveBeenCalled();
    // A caller without a snapshot still reads the current physical demand immediately.
    expect(t.copies.ready(SHA)).toEqual(t.largeCopy);
    expect(t.targets).toHaveBeenCalledOnce();
  });

  it("keeps each picture look's zoom demand within the supplied physical target snapshot", async () => {
    const t = await checkedSizes();
    expect(t.copies.ready(SHA, { ...PLAIN, zoom: 2 }, small)).toEqual(t.largeCopy);
    expect(t.targets).not.toHaveBeenCalled();
  });
});
