import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DisplayCopies } from './display-copies';

// Preserve below-normal work and one decode slot while avoiding repeated Main window construction.
const fixtures: { copies: DisplayCopies; dir: string }[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) {
    f.copies.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
function png(width: number, height: number): Uint8Array {
  const head = Buffer.alloc(45);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(head);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12);
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  head[24] = 8;
  head[25] = 6;
  head.write('IDAT', 37);
  return head;
}
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-display-worker-'));
  const windows: { id: number; gone(): void; destroy: ReturnType<typeof vi.fn> }[] = [];
  const beforeBytes = vi.fn<() => void>();
  const freeBytes = vi.fn(() => 10 * 1024 ** 3);
  const activity = { quiet: true, otherWorker: false };
  const blobs = new Map<string, Uint8Array>();
  const copies = new DisplayCopies({
    mediaDir: dir,
    targets: () => [{ width: 1920, height: 1080 }],
    canWork: () => activity.quiet,
    canStart: () => !activity.otherWorker,
    open: (gone) => {
      const win = {
        id: windows.length + 1,
        gone,
        destroy: vi.fn(),
        beforeBytes,
        saveBlob: async (blob: { url: string; bytes: number }, destination: string) => {
          const bytes = blobs.get(blob.url);
          if (bytes?.byteLength !== blob.bytes) throw new Error('Unknown generated Blob');
          await writeFile(destination, bytes);
        },
      };
      windows.push(win);
      return win;
    },
    changed: () => undefined,
    log: () => undefined,
    freeBytes,
  });
  fixtures.push({ copies, dir });
  const candidate = (letter: string) => {
    const sha256 = letter.repeat(64);
    const prefix = sha256.slice(0, 2);
    mkdirSync(join(dir, prefix), { recursive: true });
    const path = `${prefix}/${sha256}.png`;
    writeFileSync(join(dir, path), png(6144, 3456));
    return { path, sha256 };
  };
  const made = (sender: number, key: unknown, bytes: Uint8Array) => {
    const url = `blob:null/${randomUUID()}`;
    blobs.set(url, bytes);
    return copies.made(sender, key, { url, bytes: bytes.byteLength });
  };
  return { copies, windows, beforeBytes, freeBytes, activity, candidate, made };
}
async function finishFirst(t: ReturnType<typeof setup>) {
  const first = t.copies.prepare(t.candidate('a'));
  await vi.waitFor(() => expect(t.windows).toHaveLength(1));
  const job = await t.copies.next(1);
  if (!job) throw new Error('The first owned display job was not granted.');
  await t.made(1, job.key, png(1920, 1080));
  expect(await first).toMatchObject({ ok: true });
}

describe('the display worker between imports', () => {
  it.each(['made', 'cancel'] as const)(
    'exposes only its granted source and revokes it after %s',
    async (ending) => {
      const t = setup();
      const abort = new AbortController();
      const candidate = t.candidate('a');
      const prepared = t.copies.prepare(candidate, abort.signal);
      await vi.waitFor(() => expect(t.windows).toHaveLength(1));
      const key = 'p1-' + candidate.sha256.slice(0, 32) + '-1920x1080';
      expect(t.copies.workerSource(1, key)).toBeNull();
      t.beforeBytes.mockImplementation(() => {
        expect(t.copies.workerSource(1, key)).toBeNull();
      });
      const grant = t.copies.next(1);
      expect(t.copies.workerSource(1, key)).toBeNull();
      const job = await grant;
      if (!job) throw new Error('The owned source was not granted.');
      expect(t.copies.workerSource(1, key)).toEqual({ ...candidate, missing: false });
      expect(t.copies.workerSource(999, key)).toBeNull();
      expect(t.copies.workerSource(1, 'another-job')).toBeNull();
      if (ending === 'made') {
        await t.made(1, key, png(1920, 1080));
        expect(await prepared).toMatchObject({ ok: true });
      } else {
        abort.abort();
        expect(await prepared).toMatchObject({ ok: false });
      }
      expect(t.copies.workerSource(1, key)).toBeNull();
    },
  );

  it('prewarms an empty worker during a quiet refresh, never during a show', async () => {
    const t = setup();
    t.activity.quiet = false;
    await t.copies.refresh([]);
    await t.copies.idle();
    expect(t.windows).toHaveLength(0);
    t.activity.quiet = true;
    await t.copies.refresh([]);
    await t.copies.idle();
    expect(t.windows).toHaveLength(1);
    expect(t.copies.working).toBe(false);
    expect(t.windows[0]?.destroy).not.toHaveBeenCalled();
  });

  it('grants a bounded private source address instead of copying the original through Main IPC', async () => {
    const t = setup();
    const prepared = t.copies.prepare(t.candidate('a'));
    await vi.waitFor(() => expect(t.windows).toHaveLength(1));
    const job = await t.copies.next(1);
    if (!job) throw new Error('The owned display job was not granted.');
    expect(job).toMatchObject({
      source: `drashti-media://media/${job.key}`,
      maxBytes: 256 * 1024 * 1024,
      sourceSize: { width: 6144, height: 3456 },
      resizeOnly: true,
    });
    expect(job).not.toHaveProperty('data');
    await t.made(1, job.key, png(1920, 1080));
    expect(await prepared).toMatchObject({ ok: true });
  });

  it('keeps one empty worker and grants its waiting request the next import', async () => {
    const t = setup();
    await finishFirst(t);
    const waiting = t.copies.next(1);
    await t.copies.idle();
    expect(t.windows[0]?.destroy, 'no BrowserWindow construction for the next import').not.toHaveBeenCalled();
    expect(t.copies.working, 'an empty worker does not own the shared decode slot').toBe(false);
    const second = t.copies.prepare(t.candidate('b'));
    const job = await waiting;
    expect(t.windows).toHaveLength(1);
    if (!job) throw new Error('The warm worker was closed instead of receiving the next import.');
    expect(t.copies.working).toBe(true);
    await t.made(1, job.key, png(1920, 1080));
    expect(await second).toMatchObject({ ok: true });
  });

  it('rechecks priority when each owned job is actually granted', async () => {
    const t = setup();
    await finishFirst(t);
    expect(t.beforeBytes).toHaveBeenCalledOnce();
    const waiting = t.copies.next(1);
    await t.copies.idle();
    t.beforeBytes.mockClear();
    expect(
      t.beforeBytes,
      'asking for an absent job does not stand in for its later priority check',
    ).not.toHaveBeenCalled();
    const second = t.copies.prepare(t.candidate('b'));
    const job = await waiting;
    if (!job) throw new Error('The warm worker did not receive the next import.');
    expect(t.beforeBytes).toHaveBeenCalledOnce();
    await t.made(1, job.key, png(1920, 1080));
    expect(await second).toMatchObject({ ok: true });
  });

  it('grants no job at normal priority and resolves the rejected import', async () => {
    const t = setup();
    t.beforeBytes.mockImplementation(() => {
      throw new Error('OS priority was not lowered');
    });
    const prepared = t.copies.prepare(t.candidate('a'));
    await vi.waitFor(() => expect(t.windows).toHaveLength(1));
    expect(await t.copies.next(1)).toBeNull();
    expect(await prepared).toMatchObject({ ok: false });
    expect(t.windows[0]?.destroy).toHaveBeenCalledOnce();
  });

  it('lets sharpening own the decode slot while the empty worker waits', async () => {
    const t = setup();
    await finishFirst(t);
    const waiting = t.copies.next(1);
    await t.copies.idle();
    expect(t.copies.working).toBe(false);
    t.activity.otherWorker = true;
    t.freeBytes.mockClear();
    const second = t.copies.prepare(t.candidate('b'));
    // The reserve is checked immediately before queueing: observe that real preparation state.
    await vi.waitFor(() => expect(t.freeBytes).toHaveBeenCalledOnce());
    t.copies.activityChanged();
    expect(t.copies.working).toBe(false);
    expect(t.windows).toHaveLength(1);
    t.activity.otherWorker = false;
    t.copies.activityChanged();
    const job = await waiting;
    if (!job) throw new Error('The waiting display request was lost while sharpening owned the slot.');
    expect(t.copies.working).toBe(true);
    await t.made(1, job.key, png(1920, 1080));
    expect(await second).toMatchObject({ ok: true });
  });

  it('resolves an empty owned request on close and refuses a foreign sender', async () => {
    const t = setup();
    await finishFirst(t);
    const waiting = t.copies.next(1);
    await t.copies.idle();
    expect(await t.copies.next(999)).toBeNull();
    t.copies.close();
    expect(await waiting).toBeNull();
    expect(t.windows[0]?.destroy).toHaveBeenCalledOnce();
  });

  it('resolves a lost worker request and accepts output only from its replacement', async () => {
    const t = setup();
    await finishFirst(t);
    const waiting = t.copies.next(1);
    await t.copies.idle();
    t.windows[0]?.gone();
    expect(await waiting).toBeNull();
    const second = t.copies.prepare(t.candidate('b'));
    await vi.waitFor(() => expect(t.windows).toHaveLength(2));
    expect(await t.copies.next(1)).toBeNull();
    const job = await t.copies.next(2);
    if (!job) throw new Error('The replacement worker did not receive the next import.');
    t.windows[0]?.gone();
    expect(t.copies.workerSource(2, job.key)).not.toBeNull();
    expect(await t.made(1, job.key, png(1920, 1080))).toBe(false);
    expect(await t.made(2, job.key, png(1920, 1080))).toBe(true);
    expect(await second).toMatchObject({ ok: true });
  });
});
