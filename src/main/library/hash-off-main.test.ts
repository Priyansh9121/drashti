import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as WorkerThreads from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashOffMain } from './hash-off-main';

/** Each worker thread started, and how each ended. */
const threads = vi.hoisted(() => ({ started: 0, exits: [] as number[] }));
vi.mock('node:worker_threads', async (original) => {
  const real = await original<typeof WorkerThreads>();
  class Watched extends real.Worker {
    constructor(...args: ConstructorParameters<typeof real.Worker>) {
      super(...args);
      threads.started += 1;
      this.once('exit', (code: number) => {
        threads.exits.push(code);
      });
    }
  }
  return { ...real, Worker: Watched };
});

/*
 * A file's SHA-256 read in a worker thread (Session 57), never on Main's, where the show's commands wait: Trim, media
 * removal, the video copies, a model pack's re-check and (cap-packimport) its import. Generated placeholder files only.
 */

const MiB = 1024 ** 2;
const made: string[] = [];
beforeEach(() => {
  threads.started = 0;
  threads.exits.length = 0;
});
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});
const fileOf = (data: Buffer) => {
  const d = mkdtempSync(join(tmpdir(), 'drashti-hash-off-main-'));
  made.push(d);
  writeFileSync(join(d, 'placeholder.bin'), data);
  return join(d, 'placeholder.bin');
};
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
/** Every worker started has ended. */
const allEnded = () =>
  vi.waitFor(() => {
    expect(threads.exits).toHaveLength(threads.started);
  });

describe('a file’s SHA-256 off Main’s thread', () => {
  it('works it out in a worker thread with the file’s length; the worker ends by itself', async () => {
    const data = Buffer.alloc(3 * MiB + 17, 'placeholder bytes ');
    expect(await hashOffMain(fileOf(data))).toEqual({ sha256: sha(data), bytes: data.length });
    expect(threads.started).toBe(1);
    await allEnded();
    expect(threads.exits).toEqual([0]);
  });

  it('tells how far it has read when asked, in order and never past the file (cap-packimport)', async () => {
    const data = Buffer.alloc(20 * MiB, 'placeholder bytes ');
    const told: number[] = [];
    expect(await hashOffMain(fileOf(data), undefined, (bytes) => told.push(bytes))).toEqual({
      sha256: sha(data),
      bytes: data.length,
    });
    // About every 8 MB read: twice for 20 MB.
    expect(told).toHaveLength(2);
    expect(told[0]).toBeGreaterThanOrEqual(8 * MiB);
    expect(told[1]).toBeGreaterThan(told[0] ?? Infinity);
    expect(told[1]).toBeLessThan(data.length);
    await allEnded();
  });

  it('stops when its signal aborts: nothing more is told, no result is taken, and it rejects once the worker has ended (cap-packimport)', async () => {
    const control = new AbortController();
    const told: number[] = [];
    const hashing = hashOffMain(
      fileOf(Buffer.alloc(32 * MiB, 'placeholder bytes ')),
      control.signal,
      (bytes) => {
        told.push(bytes);
        control.abort();
      },
    );
    await expect(hashing).rejects.toThrow('The hash stopped before it finished.');
    expect(told).toHaveLength(1);
    expect(threads.started).toBe(1);
    expect(threads.exits).toHaveLength(1);
  });

  it('starts nothing for a signal aborted already', async () => {
    const control = new AbortController();
    control.abort();
    await expect(hashOffMain(fileOf(Buffer.from('placeholder')), control.signal)).rejects.toThrow();
    expect(threads.started).toBe(0);
  });

  it('a read error reaches the caller with its code (a file gone is ENOENT), and the worker ends', async () => {
    const gone = join(mkdtempSync(join(tmpdir(), 'drashti-hash-off-main-')), 'gone.bin');
    made.push(join(gone, '..'));
    await expect(hashOffMain(gone)).rejects.toMatchObject({ code: 'ENOENT' });
    await allEnded();
  });
});
