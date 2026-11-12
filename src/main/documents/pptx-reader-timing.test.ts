import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeckSlide } from '../../shared/deck';
import { editablePicture } from '../import/testing/editable-pptx-fixture';
import { makeTestDeck, placeholderDeckMedia, type TestDeckSlide } from '../import/testing/make-deck';
import type { PptxReaderChild, ToPptxReader } from './pptx-reader-protocol';
import { pptxReader } from './pptx-reader-service';
import type { SourceRead } from './source-reader';

/*
 * W6's review N4: Main asks the document reader for the clicks of the pages it times, and takes back only clicks that
 * read as such, for those pages only. Fake transport (as pptx-reader-service.test.ts); the reading itself is tested in
 * pptx-source-timing.test.ts.
 */

vi.mock('node:os', async (original) => ({
  ...(await original<typeof os>()),
  setPriority: vi.fn(),
}));

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

async function read(
  timingPages: number[] | undefined,
  decks: Record<number, unknown>,
  videoIds: Record<number, string[]> = {},
) {
  const root = mkdtempSync(join(os.tmpdir(), 'drashti-source-timing-worker-'));
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
      ...(videoIds[sourceIndex] === undefined ? {} : { sourceVideoShapeIds: videoIds[sourceIndex] }),
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

  it('keeps video shape ids only for asked pages whose clicks read', async () => {
    const ids = { 0: ['4'], 1: ['5'] };
    const unasked = (await read([1], { 0: clicks, 1: clicks }, ids)).result;
    const unread = (await read([0, 1], { 0: { motion: 'Placeholder' }, 1: clicks }, ids)).result;
    for (const result of [unasked, unread]) {
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.pages.map((page) => page.sourceVideoShapeIds)).toEqual([undefined, ['5']]);
    }
  });

  it('sends valid source video ids through the worker and Main without dropping a page with an odd id', async () => {
    const root = mkdtempSync(join(os.tmpdir(), 'drashti-video-shape-worker-'));
    roots.push(root);
    const outDir = join(root, 'generated');
    mkdirSync(outDir);
    const file = join(root, 'Placeholder video.pptx');
    const inch = 914_400;
    const video = (id: number, x: number): TestDeckSlide['shapes'][number] => ({
      id,
      type: 'video',
      name: 'Placeholder video',
      x: x * inch,
      y: inch,
      w: 4 * inch,
      h: 2.25 * inch,
      media: 'clip1',
      poster: 'poster1',
    });
    const page: TestDeckSlide = {
      key: 'placeholder-video',
      bg: '204060',
      transition: { kind: 'fade', dur: 400 },
      notes: 'Placeholder notes',
      shapes: [
        {
          id: 3,
          type: 'text',
          name: 'Placeholder text box',
          x: inch,
          y: 4 * inch,
          w: 6 * inch,
          h: inch,
          paras: [{ text: 'Placeholder words' }],
        },
        video(4, 1),
        video(-7, 7),
      ],
      effects: [{ kind: 'fade', target: 3, dur: 500, start: 'click' }],
    };
    writeFileSync(file, makeTestDeck([page], { ...placeholderDeckMedia(), poster1: editablePicture() }));

    const child = new Child();
    const port = new EventEmitter();
    Object.assign(port, {
      postMessage: (message: unknown) => {
        child.message(message);
        child.exit(0);
      },
    });
    const parent = Object.getOwnPropertyDescriptor(process, 'parentPort');
    Object.defineProperty(process, 'parentPort', { configurable: true, value: port });
    try {
      await import('./pptx-reader-worker');
      const pending = pptxReader(() => child, { timeoutMs: 5_000, cancelGraceMs: 10, exitGraceMs: 10 })({
        ext: 'pptx',
        file,
        outDir,
        sourcePages: [0],
        timingPages: [0],
        signal: new AbortController().signal,
        checkpoint: () => Promise.resolve(true),
      });
      await vi.waitFor(() => expect(child.sent).toHaveLength(1), { interval: 1 });
      port.emit('message', { data: child.sent[0] });
      expect(await pending).toMatchObject({
        ok: true,
        failed: [],
        pages: [
          {
            sourceIndex: 0,
            sourceVideoShapeIds: ['4'],
            deck: { motion: { effects: [expect.objectContaining({ shapeId: '3', kind: 'fade' })] } },
          },
        ],
      });
    } finally {
      if (parent) Object.defineProperty(process, 'parentPort', parent);
      else Reflect.deleteProperty(process, 'parentPort');
    }
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

  it('takes only the known parts of a page’s clicks: no keys of the reader’s own, no sound it made up', async () => {
    const junk = { placeholderExtra: 'Placeholder key of the reader’s own' };
    const { motion, transition } = clicks;
    if (!motion || !transition?.nativeTransition) throw new Error('The placeholder clicks are incomplete.');
    const dirty = {
      ...clicks,
      ...junk,
      deckAdvanceMs: 5000,
      motion: { ...motion, ...junk, effects: motion.effects.map((effect) => ({ ...effect, ...junk })) },
      transition: {
        ...transition,
        ...junk,
        soundId: 'placeholder-made-up-sound',
        nativeTransition: { ...transition.nativeTransition, ...junk },
      },
    };
    const { result } = await read([1], { 1: dirty });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages[1]?.deck).toEqual(clicks);
  });
});
