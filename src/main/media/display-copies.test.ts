import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DisplayCopies } from './display-copies';

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
function setup(bytes = png(6144, 3456), free = 10 * 1024 ** 3, existing?: string) {
  const dir = existing ?? mkdtempSync(join(tmpdir(), 'drashti-display-'));
  if (!existing) dirs.push(dir);
  mkdirSync(join(dir, 'aa'), { recursive: true });
  const path = `aa/${SHA}.png`;
  writeFileSync(join(dir, path), bytes);
  const windows = { opened: 0, destroyed: 0 };
  const copies = new DisplayCopies({
    mediaDir: dir,
    targets: () => [{ width: 1920, height: 1080 }],
    open: () => {
      windows.opened++;
      return {
        id: windows.opened,
        destroy: () => {
          windows.destroyed++;
        },
      };
    },
    changed: () => undefined,
    log: () => undefined,
    freeBytes: () => free,
  });
  services.push(copies);
  return { dir, copies, windows, candidate: { path, sha256: SHA } };
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
    expect(job.data).toEqual(new Uint8Array(png(6144, 3456)));
    const output = png(1920, 1080);
    expect(await t.copies.made(1, job.key, new Uint8Array(output))).toBe(true);
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
    await t.copies.made(1, job.key, new Uint8Array(png(1920, 1080)));
    const made = await first;
    const again = setup(png(6144, 3456), 10 * 1024 ** 3, t.dir);
    expect(await again.copies.prepare(again.candidate)).toEqual(made);
    expect(again.windows.opened).toBe(0);
  });
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
    await t.copies.made(1, job.key, new Uint8Array(png(320, 180)));
    expect(await prepared).toMatchObject({ ok: false });
    expect(t.copies.ready(SHA)).toBeNull();
  });
  it('will not read a candidate outside the owned media folder', async () => {
    const t = setup();
    expect(await t.copies.prepare({ ...t.candidate, path: '../outside.png' })).toMatchObject({ ok: false });
    expect(t.windows.opened).toBe(0);
  });
});
