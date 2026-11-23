import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

/*
 * The output's paint latency, told apart from the refreshes Chromium itself dropped (a21, the owner's "A, yes" to
 * QA21-FLAKY-1). On CI's Mac the compositor thread's frame-deadline timer wakes 12-20 ms late with every thread idle,
 * and Chromium drops the next refresh to catch up (its trace: Scheduler::BeginFrameDropped and
 * LayerTreeHostImpl::DidNotProduceFrame, kRecoverLatency); a change drawn into the page just before such a refresh
 * waits a second refresh, which is not Drashti's. Only Chromium's own trace says which refreshes it dropped: nothing
 * here guesses it from times. And every change must reach the very first frame the output begins after it is drawn
 * into the page (no frame of Drashti's own in between).
 */

/** The output page's own record, kept by the test's hook (never in a packaged Drashti). */
interface PaintFramesGlobals {
  /** Every frame from the hook on: its frame time and when its callbacks ran (the page's clock, ms). */
  drashtiTestFrames?: [number, number][];
  /** Each frame callback that showed a new revision as painted: when it was asked for, its frame, when it ran. */
  drashtiTestPaints?: { rev: number; askedAt: number; frameTime: number; ranAt: number }[];
}

/**
 * Keep the output page's frames and, for each change, the frame request that painted it (the one whose callback moved
 * data-painted-rev on). `lateByAFrame` (a red test's deliberate fault): every frame request made outside a frame waits
 * one more frame, as a paint one frame late would.
 */
export const watchPaintFrames = (output: Page, lateByAFrame = false) =>
  output.evaluate((late) => {
    const g = globalThis as typeof globalThis & PaintFramesGlobals;
    const original = window.requestAnimationFrame.bind(window);
    const root = () => document.querySelector<HTMLElement>('[data-testid="output-root"]');
    g.drashtiTestFrames = [];
    g.drashtiTestPaints = [];
    let inFrame = 0;
    window.requestAnimationFrame = (callback) => {
      const askedAt = performance.now();
      const run = (time: number) => {
        const before = root()?.dataset['paintedRev'];
        inFrame++;
        try {
          callback(time);
        } finally {
          inFrame--;
        }
        const after = root()?.dataset['paintedRev'];
        if (after !== undefined && after !== before)
          g.drashtiTestPaints?.push({
            rev: Number(after),
            askedAt,
            frameTime: time,
            ranAt: performance.now(),
          });
      };
      return late && inFrame === 0 ? original(() => original(run)) : original(run);
    };
    const tick = (time: number) => {
      g.drashtiTestFrames?.push([time, performance.now()]);
      original(tick);
    };
    original(tick);
  }, lateByAFrame);

export const paintFrames = (output: Page) =>
  output.evaluate(() => {
    const g = globalThis as typeof globalThis & PaintFramesGlobals;
    return { frames: g.drashtiTestFrames ?? [], paints: g.drashtiTestPaints ?? [] };
  });

/** Chromium's trace of the compositors' refreshes, with a mark in the output page to set its clock against. */
export async function startRefreshTrace(app: ElectronApplication, output: Page): Promise<void> {
  await app.evaluate(async ({ contentTracing }) => {
    await contentTracing.startRecording({
      included_categories: ['cc', 'blink.user_timing'],
      excluded_categories: ['*'],
      recording_mode: 'record-until-full',
      trace_buffer_size_in_kb: 200 * 1024,
    });
  });
  await output.evaluate(() => performance.mark('drashti-refresh-clock'));
}

export const stopRefreshTrace = (app: ElectronApplication, file: string) =>
  app.evaluate(async ({ contentTracing }, f) => {
    await contentTracing.stopRecording(f);
  }, file);

interface TraceEvent {
  name?: string;
  ph?: string;
  pid?: number;
  ts?: number;
  args?: {
    args?: { frame_time_us?: number; sequence_number?: number };
    data?: { startTime?: number };
    'Frame Sequence Number'?: number;
    FrameSkippedReason?: string;
  };
}

/**
 * The output's refreshes as Chromium's trace says: each one's frame time on the output page's clock (ms), and the
 * ones its compositor dropped to recover latency.
 */
export function outputRefreshes(file: string): { at: Map<number, number>; dropped: Set<number> } {
  if (!existsSync(file)) throw new Error('Chromium’s trace was not saved');
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { traceEvents?: TraceEvent[] } | TraceEvent[];
  const events = Array.isArray(parsed) ? parsed : (parsed.traceEvents ?? []);
  const mark = events.find((e) => e.name === 'drashti-refresh-clock');
  const startTime = mark?.args?.data?.startTime;
  if (mark?.ts === undefined || startTime === undefined)
    throw new Error('the output page’s clock mark is not in Chromium’s trace');
  // The trace's clock (µs) less the page's (ms): one clock, its origin apart.
  const origin = mark.ts - startTime * 1000;
  const at = new Map<number, number>();
  const dropped = new Set<number>();
  for (const e of events) {
    if (e.pid !== mark.pid) continue;
    if (e.name === 'Scheduler::BeginFrame' && e.ph === 'X') {
      const seq = e.args?.args?.sequence_number;
      const frame = e.args?.args?.frame_time_us;
      if (seq === undefined || frame === undefined) continue;
      const time = (frame - origin) / 1000;
      const known = at.get(seq);
      // One page in this renderer: one refresh for each sequence number, or its frames cannot be told apart.
      if (known !== undefined && known !== time)
        throw new Error(`two frame times for refresh ${String(seq)} in the output’s renderer`);
      at.set(seq, time);
    }
    if (
      e.name === 'LayerTreeHostImpl::DidNotProduceFrame' &&
      e.args?.FrameSkippedReason === 'kRecoverLatency' &&
      e.args['Frame Sequence Number'] !== undefined
    )
      dropped.add(e.args['Frame Sequence Number']);
  }
  return { at, dropped };
}

export interface PaintPart {
  rev: number;
  /** As the page measured it: from the main process to the frame that painted it (ms). */
  latency: number;
  /** Less the refreshes Chromium dropped while the change waited (ms). */
  drashti: number;
  /** Those refreshes' sequence numbers. */
  dropped: number[];
  /** Whether it was painted in the first frame the output began after it was drawn into the page. */
  firstFrame: boolean;
}

/** Each change's part: `latency` by revision, the page's frames and paints, the trace's refreshes. */
export function paintParts(
  latency: Map<number, number>,
  record: Awaited<ReturnType<typeof paintFrames>>,
  refreshes: ReturnType<typeof outputRefreshes>,
): PaintPart[] {
  const sequence = [...refreshes.at.entries()].sort((a, b) => a[0] - b[0]);
  return [...latency.entries()].map(([rev, ms]) => {
    const paint = record.paints.find((p) => p.rev === rev);
    if (!paint) throw new Error(`no frame painted revision ${String(rev)}`);
    // The first frame whose callbacks ran after the change asked for its frame must be the one that painted it.
    const first = record.frames.find(([, ranAt]) => ranAt > paint.askedAt);
    const firstFrame = first?.[0] === paint.frameTime;
    // Refreshes Chromium dropped (its own word) that began after the change was drawn and before its frame: each
    // held it until Chromium's next refresh.
    const dropped: number[] = [];
    let held = 0;
    sequence.forEach(([seq, time], i) => {
      if (!refreshes.dropped.has(seq) || time < paint.askedAt || time >= paint.frameTime) return;
      const next = sequence[i + 1];
      if (!next) return;
      dropped.push(seq);
      held += next[1] - time;
    });
    return { rev, latency: ms, drashti: Math.max(0, Math.round(ms - held)), dropped, firstFrame };
  });
}
