import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDITABLE_SOURCE_LIMITS, type EditablePdfJob } from '../../../shared/editable-source';
import { drawEditablePdf } from './editable-main';

/*
 * Edit slides on a PDF reads every page's words and shapes in the hidden pictures window before the editor shows
 * (src/main/library/imported-slides.ts). Session 57: on CI's Mac the generated 100-page placeholder PDF stayed at
 * "Opening the slides…" past the editor's 30 s (tests/e2e/import-timing.spec.ts): the window gave way for 10 ms and
 * then asked Main whether it might go on at each of a page's small steps (about ten a page), so most of the opening
 * was waiting, and on a busy Mac each of those waits takes far longer than 10 ms. Here the window runs against a
 * stand-in PDF and a stand-in page reader whose steps take only the time the test says, on a clock of the test's own.
 */

const clock = vi.hoisted(() => ({ now: 0, pauses: [] as number[], working: 0, longest: 0 }));
/** Each page's steps (the page reader's own checkpoints) and how long each step's work takes, by page. */
const core = vi.hoisted(() => ({ steps: 10, stepMs: (_page: number): number => 0 }));

vi.mock('pdfjs-dist', () => ({
  OPS: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 100,
      getPage: (n: number) => Promise.resolve({ index: n - 1, cleanup: () => undefined }),
    }),
    destroy: () => Promise.resolve(),
  }),
}));

vi.mock('../../../shared/pdf-edit-page', () => ({
  editablePdfPage: async (
    _doc: unknown,
    page: { index: number },
    _ops: unknown,
    control: { checkpoint?: () => Promise<void> },
  ) => {
    for (let step = 0; step < core.steps; step++) {
      const ms = core.stepMs(page.index);
      clock.now += ms;
      clock.working += ms;
      clock.longest = Math.max(clock.longest, clock.working);
      await control.checkpoint?.();
    }
    return { width: 960, height: 540, elements: [], assets: [], issues: [] };
  },
}));

class Assets {
  fetch(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array());
  }
}

const job = (pages: number): EditablePdfJob => ({
  mode: 'editable-source',
  jobId: 'placeholder-job',
  data: new Uint8Array(),
  sourcePages: Array.from({ length: pages }, (_, index) => index),
  limits: EDITABLE_SOURCE_LIMITS,
  timeBudgetMs: 178_000,
});

/** What the window sent Main, in order, with the clock's time. */
let sent: { mode: string; sourceIndex?: number; total?: number; at: number }[] = [];
let finished: { total: number; failed: number[] } | null = null;

beforeEach(() => {
  clock.now = 0;
  clock.pauses = [];
  clock.working = 0;
  clock.longest = 0;
  core.steps = 10;
  core.stepMs = () => 0;
  sent = [];
  finished = null;
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
  // A pause takes exactly what it asks for on the test's clock, and ends the work in hand.
  vi.stubGlobal('setTimeout', (resume: () => void, ms = 0) => {
    clock.pauses.push(ms);
    clock.now += ms;
    if (ms > 0) clock.working = 0;
    queueMicrotask(resume);
    return 0;
  });
  vi.stubGlobal('window', {
    drashti: {
      pictures: {
        page: (message: { mode: string; sourceIndex?: number; total?: number }) => {
          sent.push({ ...message, at: clock.now });
          return Promise.resolve(true);
        },
        done: (message: { total: number; failed: number[] }) => {
          finished = message;
          return Promise.resolve();
        },
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const pages = () => sent.filter((m) => m.mode === 'editable-source').map((m) => m.sourceIndex);
const checkpoints = () => sent.filter((m) => m.mode === 'editable-checkpoint');

describe('preparing a PDF for Edit slides in the hidden window (Session 57)', () => {
  it('a 100-page PDF of quick pages neither idles nor asks Main at each small step', async () => {
    await drawEditablePdf(job(100), Assets);
    expect(pages()).toEqual(Array.from({ length: 100 }, (_, index) => index));
    expect(finished).toEqual({ mode: 'editable-source', jobId: 'placeholder-job', total: 100, failed: [] });
    // It was 10 ms and a round trip to Main at each of 1,100 steps: 11 s of waiting before the editor showed.
    const waited = clock.pauses.reduce((sum, ms) => sum + ms, 0);
    expect(waited, `${String(clock.pauses.length)} pauses`).toBeLessThan(1_000);
    expect(checkpoints().length).toBeLessThanOrEqual(100);
  });

  it('still gives way: never 100 ms of work without a pause', async () => {
    core.steps = 12;
    core.stepMs = () => 20;
    await drawEditablePdf(job(3), Assets);
    expect(pages()).toEqual([0, 1, 2]);
    expect(clock.longest).toBeLessThan(100);
  });

  it('asks Main first (saying the page count), then at least every 100 ms', async () => {
    core.steps = 12;
    core.stepMs = () => 20;
    await drawEditablePdf(job(3), Assets);
    expect(sent[0]).toMatchObject({ mode: 'editable-checkpoint', sourceIndex: 0, total: 100 });
    let last = 0;
    for (const message of sent) {
      expect(message.at - last).toBeLessThanOrEqual(100);
      last = message.at;
    }
    expect(clock.now - last).toBeLessThanOrEqual(100);
  });

  it('still leaves a page that runs past its share of the time as its saved picture, and goes on', async () => {
    core.steps = 4;
    // 12 s on the first page: past its 8 s; the next two quick.
    core.stepMs = (page) => (page === 0 ? 3_000 : 0);
    await drawEditablePdf(job(3), Assets);
    expect(pages()).toEqual([1, 2]);
    expect(finished).toMatchObject({ total: 100, failed: [0] });
  });
});
