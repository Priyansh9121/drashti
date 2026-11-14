import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EDITABLE_SOURCE_LIMITS, type PreparedSource } from '../../shared/editable-source';
import type { SourceRead } from './source-reader';
import type { PptxReaderChild, ToPptxReader } from './pptx-reader-protocol';
import { pptxReader } from './pptx-reader-service';

// Fake transport tests only scheduling/validation. Real OOXML source tests remain independent.
class Child implements PptxReaderChild {
  sent: ToPptxReader[] = [];
  killed = 0;
  message: (message: unknown) => void = () => undefined;
  exit: (code: number) => void = () => undefined;
  post(message: ToPptxReader): void {
    this.sent.push(message);
  }
  onMessage(listener: (message: unknown) => void): void {
    this.message = listener;
  }
  onExit(listener: (code: number) => void): void {
    this.exit = listener;
  }
  kill(): void {
    this.killed++;
  }
}
const roots: string[] = [];
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'drashti-source-worker-'));
  roots.push(root);
  const outDir = join(root, 'generated');
  mkdirSync(outDir);
  const stop = new AbortController();
  const request: SourceRead = {
    ext: 'pptx',
    file: join(root, 'Placeholder.pptx'),
    outDir,
    sourcePages: [0],
    signal: stop.signal,
    checkpoint: () => Promise.resolve(true),
  };
  const child = new Child();
  const read = pptxReader(() => child, { timeoutMs: 5_000, cancelGraceMs: 10, exitGraceMs: 10 });
  return { root, request, stop, child, read };
}
/** The worker's one reply to the job it was given, then its exit: what Main makes of it. */
async function answer(
  t: ReturnType<typeof setup>,
  reply: (jobId: string) => unknown,
): Promise<PreparedSource> {
  const pending = t.read(t.request);
  await vi.waitFor(() => expect(t.child.sent).toHaveLength(1), { interval: 1 });
  const start = t.child.sent[0];
  if (start?.type !== 'read') throw new Error('No source start.');
  t.child.message(reply(start.jobId));
  t.child.exit(0);
  return await pending;
}
const page = (elements: unknown[], assets: unknown[]) => ({
  sourceIndex: 0,
  width: 960,
  height: 540,
  background: '#ffffff',
  elements,
  assets,
  issues: [],
});
const placeholderShape = {
  id: 'Placeholder shape',
  kind: 'shape',
  frame: { x: 0, y: 0, width: 10, height: 10 },
  fill: '#123456',
  opacity: 1,
  cornerRadius: 0,
};
const placeholderImage = (index: number) => ({
  id: `Placeholder image ${String(index)}`,
  kind: 'image',
  mediaId: `media-ref:${String(index)}`,
  fit: 'fit',
  frame: { x: 0, y: 0, width: 10, height: 10 },
});
afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('PPTX source utility lifecycle', () => {
  it('waits for child exit before publishing a validated reply, and ignores late messages', async () => {
    const t = setup();
    const pending = t.read(t.request);
    await vi.waitFor(() => expect(t.child.sent).toHaveLength(1), { interval: 1 });
    const start = t.child.sent[0];
    if (start?.type !== 'read') throw new Error('No source start.');
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    t.child.message({
      type: 'prepared',
      jobId: start.jobId,
      pages: [
        {
          sourceIndex: 0,
          width: 960,
          height: 540,
          background: '#ffffff',
          elements: [],
          assets: [],
          issues: [],
        },
      ],
      total: 1,
      failed: [],
    });
    await Promise.resolve();
    expect(t.child.killed).toBe(1);
    expect(settled).toBe(false);
    t.child.exit(0);
    expect(await pending).toMatchObject({ ok: true, total: 1 });
    t.child.message({ type: 'failed', jobId: start.jobId });
    expect(t.child.killed).toBe(1);
  });

  // A note on page 1 of a one-page deck fails on the deck's length first; in a two-page deck, it reaches the check
  // that its page is one that failed (C23's review LOW-3).
  it.each([
    { index: 0, total: 1, kept: true },
    { index: 1, total: 1, kept: false },
    { index: 1, total: 2, kept: false },
  ])(
    'passes a source note only for its own failed page ($index of $total)',
    async ({ index, total, kept }) => {
      const t = setup();
      const pending = t.read(t.request);
      await vi.waitFor(() => expect(t.child.sent).toHaveLength(1), { interval: 1 });
      const start = t.child.sent[0];
      if (start?.type !== 'read') throw new Error('No source start.');
      const failedNotes = { [index]: ['Placeholder source page exceeds the 500-object editing limit.'] };
      t.child.message({ type: 'prepared', jobId: start.jobId, pages: [], total, failed: [0], failedNotes });
      await vi.waitFor(() => expect(t.child.killed).toBe(1), { interval: 1 });
      t.child.exit(0);
      expect(await pending).toMatchObject(
        kept ? { ok: true, pages: [], total, failed: [0], failedNotes } : { ok: false },
      );
    },
  );

  // C25's review LOW-2: Main's own checks refuse a hostile reply, whatever the worker says it checked.
  it.each([
    [1_000_000, true],
    [1_000_001, false],
  ])('checks a drawing placed at %s itself', async (x, kept) => {
    const t = setup();
    const result = await answer(t, (jobId) => ({
      type: 'prepared',
      jobId,
      total: 1,
      failed: [],
      pages: [page([{ ...placeholderShape, frame: { x, y: 0, width: 10, height: 10 } }], [])],
    }));
    expect(result.ok).toBe(kept);
  });

  it('checks a page’s pictures itself: each file once, up to 32 MiB', async () => {
    for (const over of [false, true]) {
      const t = setup();
      // A file made as long as the limit without writing it (sparse where the disk allows): Main reads only its size.
      const big = join(t.request.outDir, 'placeholder-big.png');
      writeFileSync(big, '');
      truncateSync(big, EDITABLE_SOURCE_LIMITS.pageAssetBytes);
      writeFileSync(join(t.request.outDir, 'placeholder-small.png'), 'x');
      // Two pictures of the one big file count it once: the page is exactly at the limit, and one byte more is over.
      const files = [
        'placeholder-big.png',
        'placeholder-big.png',
        ...(over ? ['placeholder-small.png'] : []),
      ];
      const result = await answer(t, (jobId) => ({
        type: 'prepared',
        jobId,
        total: 1,
        failed: [],
        pages: [
          page(
            files.map((_, i) => placeholderImage(i)),
            files.map((relative, i) => ({ token: `media-ref:${String(i)}`, relative, kind: 'image' })),
          ),
        ],
      }));
      expect(result.ok, over ? 'one byte over the limit' : 'exactly the limit').toBe(!over);
    }
  });

  it('cancels with a bounded grace and quarantines unconfirmed output without spawning another child', async () => {
    vi.useFakeTimers();
    const t = setup();
    const pending = t.read(t.request);
    await vi.advanceTimersByTimeAsync(1);
    t.stop.abort();
    expect(t.child.sent.at(-1)?.type).toBe('cancel');
    await vi.advanceTimersByTimeAsync(21);
    expect(await pending).toMatchObject({ ok: false, retainOutput: true });
    expect(t.child.killed).toBeGreaterThanOrEqual(1);
    expect((await t.read({ ...t.request, signal: new AbortController().signal })).ok).toBe(false);
    t.child.exit(0);
  });

  it('refuses a stale job reply and an asset escaping the Main output directory', async () => {
    for (const stale of [true, false]) {
      const t = setup();
      writeFileSync(
        join(t.root, 'escape.png'),
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      const pending = t.read(t.request);
      await vi.waitFor(() => expect(t.child.sent).toHaveLength(1), { interval: 1 });
      const start = t.child.sent[0];
      if (start?.type !== 'read') throw new Error('No source start.');
      t.child.message({
        type: 'prepared',
        jobId: stale ? 'Different job' : start.jobId,
        pages: [
          {
            sourceIndex: 0,
            width: 960,
            height: 540,
            background: '#ffffff',
            elements: [
              {
                id: 'Placeholder image',
                kind: 'image',
                mediaId: 'media-ref:0',
                fit: 'fit',
                frame: { x: 0, y: 0, width: 10, height: 10 },
              },
            ],
            assets: [{ token: 'media-ref:0', relative: '../escape.png', kind: 'image' }],
            issues: [],
          },
        ],
        total: 1,
        failed: [],
      });
      t.child.exit(0);
      expect((await pending).ok).toBe(false);
    }
  });
});
