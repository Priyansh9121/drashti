import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeckSlide } from '../../shared/deck';
import type { PptxReaderChild, ToPptxReader } from './pptx-reader-protocol';
import { pptxReader } from './pptx-reader-service';
import type { SourceRead } from './source-reader';

/*
 * W6's review N4: Main asks the document reader for the clicks of the pages it times, and takes back only clicks that
 * read as such, for those pages only. Fake transport (as pptx-reader-service.test.ts); the reading itself is tested in
 * pptx-source-timing.test.ts.
 */

class Child implements PptxReaderChild {
  sent: ToPptxReader[] = [];
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
    /* The fake exits when the test says. */
  }
}

const clicks: DeckSlide = {
  steps: [],
  media: [],
  motion: {
    approximate: false,
    stepsMs: [0, 500],
    effects: [{ shapeId: '3', step: 1, phase: 'in', kind: 'fade', delayMs: 0, durationMs: 500 }],
  },
  transition: {
    name: 'p:fade',
    durationMs: 400,
    nativeTransition: { kind: 'dissolve', deckEffect: 'dissolve', durationMs: 400 },
  },
};

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function read(timingPages: number[] | undefined, decks: Record<number, unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'drashti-source-timing-worker-'));
  roots.push(root);
  const outDir = join(root, 'generated');
  mkdirSync(outDir);
  const request: SourceRead = {
    ext: 'pptx',
    file: join(root, 'Placeholder.pptx'),
    outDir,
    sourcePages: [0, 1],
    ...(timingPages ? { timingPages } : {}),
    signal: new AbortController().signal,
    checkpoint: () => Promise.resolve(true),
  };
  const child = new Child();
  const pending = pptxReader(() => child, { timeoutMs: 5_000, cancelGraceMs: 10, exitGraceMs: 10 })(request);
  await vi.waitFor(() => expect(child.sent).toHaveLength(1), { interval: 1 });
  const start = child.sent[0];
  if (start?.type !== 'read') throw new Error('No source start.');
  child.message({
    type: 'prepared',
    jobId: start.jobId,
    pages: [0, 1].map((sourceIndex) => ({
      sourceIndex,
      width: 960,
      height: 540,
      background: '#204060',
      elements: [],
      assets: [],
      issues: [],
      ...(decks[sourceIndex] === undefined ? {} : { deck: decks[sourceIndex] }),
    })),
    total: 2,
    failed: [],
  });
  child.exit(0);
  return { start, result: await pending };
}

describe('the clicks of a slide imported before alpha.17, through the document reader', () => {
  it('asks for the timed pages among those it reads, and only when there are some', async () => {
    expect((await read([1, 5], {})).start.timingPages).toEqual([1]);
    expect('timingPages' in (await read(undefined, {})).start).toBe(false);
    expect('timingPages' in (await read([], {})).start).toBe(false);
  });

  it('takes a timed page’s clicks, and nothing for a page it did not time', async () => {
    const { result } = await read([1], { 0: clicks, 1: clicks });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((page) => page.deck)).toEqual([undefined, clicks]);
  });

  it('keeps a page whose clicks don’t read, without them', async () => {
    const baked = {
      ...clicks,
      steps: [{ clipId: 'placeholder-clip', clipMs: 600, lastId: 'placeholder-last' }],
    };
    const { result } = await read([0, 1], { 0: { motion: 'Placeholder' }, 1: baked });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((page) => [page.sourceIndex, page.deck])).toEqual([
      [0, undefined],
      [1, undefined],
    ]);
  });
});
