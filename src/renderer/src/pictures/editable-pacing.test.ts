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

/** The test's clock; `overrun`: how many times longer than asked a pause takes (CI's Mac: about four). */
const clock = vi.hoisted(() => ({
  now: 0,
  pauses: [] as number[],
  waited: 0,
  overrun: 1,
  working: 0,
  longest: 0,
}));
/** Each page's steps (the page reader's own checkpoints) and how long each step's work takes, by page. */
const core = vi.hoisted(() => ({
  steps: 10,
  stepMs: (_page: number): number => 0,
  assetBytes: 0,
  budgets: [] as number[],
}));

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
    control: { checkpoint?: () => Promise<void>; maxAssetBytes: number },
  ) => {
    core.budgets.push(control.maxAssetBytes);
    for (let step = 0; step < core.steps; step++) {
      const ms = core.stepMs(page.index);
      clock.now += ms;
      clock.working += ms;
      clock.longest = Math.max(clock.longest, clock.working);
      await control.checkpoint?.();
    }
    return {
      width: 960,
      height: 540,
      elements: [],
      assets: core.assetBytes ? [{ id: 'placeholder', png: new Uint8Array(core.assetBytes) }] : [],
      issues: [],
    };
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
let skipped: number | null = null;

beforeEach(() => {
  clock.now = 0;
  clock.pauses = [];
  clock.waited = 0;
  clock.overrun = 1;
  clock.working = 0;
  clock.longest = 0;
  core.steps = 10;
  core.assetBytes = 0;
  core.budgets = [];
  skipped = null;
  core.stepMs = () => 0;
  sent = [];
  finished = null;
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
  // A pause takes what it asks for on the test's clock (times the overrun), and ends the work in hand.
  vi.stubGlobal('setTimeout', (resume: () => void, ms = 0) => {
    clock.pauses.push(ms);
    clock.now += ms * clock.overrun;
    clock.waited += ms * clock.overrun;
    if (ms > 0) clock.working = 0;
    queueMicrotask(resume);
    return 0;
  });
  vi.stubGlobal('window', {
    drashti: {
      pictures: {
        page: (message: { mode: string; sourceIndex?: number; total?: number }) => {
          sent.push({ ...message, at: clock.now });
          return Promise.resolve(
            message.mode === 'editable-source' && message.sourceIndex === skipped ? 'skipped' : true,
          );
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

  it('keeps the full byte budget for the next page when Main skips a page', async () => {
    skipped = 0;
    core.assetBytes = 50;
    const request = job(3);
    request.limits = { ...request.limits, jobAssetBytes: 100 };
    await drawEditablePdf(request, Assets);
    expect(pages()).toEqual([0, 1, 2]);
    expect(core.budgets).toEqual([100, 100, 50]);
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

  it('where a pause takes four times as long as asked (CI’s Mac), gives way less often: about a fifth of the time', async () => {
    // As CI's Mac read the placeholder's pages: 75 ms a page, and a "10 ms" pause took 38 ms on average.
    clock.overrun = 4;
    core.stepMs = () => 7.5;
    await drawEditablePdf(job(100), Assets);
    expect(pages()).toHaveLength(100);
    const work = 100 * 10 * 7.5;
    // It gave way for 10 ms after each 50 ms of work, so 40 ms after each 50 ms: nearly as long as it worked.
    expect(clock.waited, `${String(clock.pauses.length)} pauses`).toBeLessThanOrEqual(work * 0.3);
    expect(clock.waited).toBeGreaterThanOrEqual(work * 0.15);
    // Never long without a pause, nor without asking Main.
    expect(clock.longest).toBeLessThanOrEqual(260);
    let last = 0;
    for (const message of sent) {
      expect(message.at - last).toBeLessThanOrEqual(300);
      last = message.at;
    }
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
