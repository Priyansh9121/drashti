import type { BrowserWindow } from 'electron';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ELDHistogram } from 'node:perf_hooks';
import type { DrashtiBridge } from '../shared/bridge';

/*
 * Performance self-test, run by hand on the real machines (README,
 * "Performance check"): while a big import runs, slide changes must keep
 * reaching the screen within a frame. It imports a few hundred generated
 * placeholder lyrics files into a throwaway library while changing slides
 * every 40 ms from the operator window, and measures each change from the
 * operator's request to the frame the output painted.
 *
 * DRASHTI_SELFTEST=performance runs it headless (it prints the result and
 * exits). These timings used to be checked in CI, where virtual machines
 * stall now and then and made the test flaky; CI keeps the checks that do
 * not depend on the machine's speed (tests/e2e/import.spec.ts).
 */

export interface PerfCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface PerfResult {
  passed: boolean;
  checks: PerfCheck[];
  /** Every figure measured, for the record. */
  summary: string;
}

export interface PerfContext {
  operator: () => BrowserWindow | null;
  outputs: () => BrowserWindow[];
  /** Make sure an output is showing; returns an undo function. */
  ensureOutput: () => Promise<() => void>;
  /** True while the import worker process is running. */
  workerRunning: () => boolean;
  diagnostics: { loopDelay: ELDHistogram; handlerTimes: Map<string, number>; gc: { max: number } };
}

/** How big the test import is. */
export const PERF_SONGS = 400;
const VERSES = 16;

function song(i: number): string {
  const lines = ['[Chorus]', `Placeholder chorus ${i}`, ''];
  for (let v = 1; v <= VERSES; v++) {
    lines.push(`[Verse ${v}]`);
    for (let s = 1; s <= 3; s++)
      lines.push(`Placeholder song ${i}, verse ${v}, slide ${s}`, 'Placeholder line two', '');
    lines.push('[Chorus]', '');
  }
  return lines.join('\n');
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const percentile = (values: readonly number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? Infinity;
};

interface Sample {
  rev: number;
  sentAt: number;
  during: boolean;
}

/**
 * Runs in the operator page: change slides every 40 ms, first with nothing
 * else going on, then all through an import of `folder`. Kept free of
 * anything outside it, as it is sent to the page as source.
 */
async function slideChangesDuringImport(folder: string) {
  const d = (globalThis as unknown as { drashti: DrashtiBridge }).drashti;
  const id = (await d.library.listPresentations()).find((p) => p.name === 'Language test slides')?.id ?? '';
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const samples: { rev: number; sentAt: number; during: boolean }[] = [];
  let slide = 0;
  const change = async (during: boolean) => {
    slide = (slide + 1) % 3;
    const sentAt = Date.now();
    const r = await d.engine.dispatch({ type: 'goLive', presentationId: id, slideIndex: slide });
    if (r.ok && r.changed) samples.push({ rev: r.rev, sentAt, during });
  };
  for (let i = 0; i < 25; i++) {
    await change(false);
    await wait(40);
  }
  const state = { finished: false };
  const startedAt = Date.now();
  const imported = d.library.importPaths([folder]).then((result) => {
    state.finished = true;
    return result;
  });
  while (!state.finished) {
    await change(true);
    await wait(40);
  }
  const result = await imported;
  return { samples, result, importMs: Date.now() - startedAt };
}

const js = <T>(win: BrowserWindow, code: string) =>
  win.webContents.executeJavaScript(code, true) as Promise<T>;

export async function runPerformanceTest(ctx: PerfContext): Promise<PerfResult> {
  const checks: PerfCheck[] = [];
  const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });
  const folder = mkdtempSync(join(tmpdir(), 'drashti-perf-lyrics-'));
  const undo = await ctx.ensureOutput();
  try {
    for (let i = 1; i <= PERF_SONGS; i++) {
      writeFileSync(join(folder, `Placeholder Song ${String(i).padStart(3, '0')}.txt`), song(i));
    }
    const operator = ctx.operator();
    let output: BrowserWindow | undefined;
    for (let i = 0; i < 100 && !output; i++) {
      output = ctx.outputs()[0];
      if (!output) await sleep(100);
    }
    if (!operator || !output) {
      check('an output window is open', false);
      return { passed: false, checks, summary: '' };
    }
    const shown = output;
    for (let i = 0; i < 100; i++) {
      const fonts = await js<string>(
        shown,
        `document.querySelector('[data-testid="output-root"]')?.dataset.fonts ?? ''`,
      );
      if (fonts === 'ready') break;
      await sleep(100);
    }

    // The test output covers the operator window, and a covered window's timers are slowed to
    // about one a second; the slide changes are the operator's here, so keep them on time.
    operator.webContents.setBackgroundThrottling(false);
    const d = ctx.diagnostics;
    d.loopDelay.reset();
    d.handlerTimes.clear();
    d.gc.max = 0;
    const running = js<{
      samples: Sample[];
      result: { ok: boolean; message?: string; run?: { totals: { failed: number; imported: number } } };
      importMs: number;
    }>(operator, `(${slideChangesDuringImport.toString()})(${JSON.stringify(folder)})`);
    const state = { done: false };
    void running.finally(() => {
      state.done = true;
    });
    let sawWorker = false;
    while (!state.done) {
      sawWorker ||= ctx.workerRunning();
      await sleep(50);
    }
    const run = await running;
    if (!operator.isDestroyed()) operator.webContents.setBackgroundThrottling(true);
    const loopP99 = Math.round(d.loopDelay.percentile(99) / 1e6);
    const loopMax = Math.round(d.loopDelay.max / 1e6);
    const slowest = [...d.handlerTimes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([channel, ms]) => `${channel} ${Math.round(ms)}`);

    // Pair each change with the first frame the output painted at or after its revision.
    await sleep(200);
    const paints = await js<{ rev: number; paintedAt: number }[]>(shown, 'globalThis.drashtiPaintLog ?? []');
    const latency = (s: Sample) => (paints.find((p) => p.rev >= s.rev)?.paintedAt ?? Infinity) - s.sentAt;
    const idle = run.samples.filter((s) => !s.during).map(latency);
    const during = run.samples.filter((s) => s.during).map(latency);
    const line = (label: string, v: number[]) =>
      `${label}: n=${v.length} median ${percentile(v, 0.5)} ms, p90 ${percentile(v, 0.9)} ms, worst ${Math.max(...v)} ms`;
    const summary = `import of ${PERF_SONGS} files took ${run.importMs} ms; ${line('idle', idle)}; ${line('importing', during)}; main event loop delay p99 ${loopP99} ms, max ${loopMax} ms; slowest handlers (ms) ${slowest.join(', ')}; longest GC ${Math.round(d.gc.max)} ms`;

    const totals = run.result.run?.totals;
    check('the import ran in its own process', sawWorker);
    check(
      'the import finished without failures',
      run.result.ok && totals?.failed === 0 && totals.imported === PERF_SONGS,
      run.result.ok
        ? `${totals?.imported ?? 0} imported, ${totals?.failed ?? 0} failed`
        : (run.result.message ?? ''),
    );
    check('the import overlapped at least 10 slide changes', during.length >= 10, `${during.length}`);
    // 60 Hz: a frame is 16.7 ms.
    check(
      'half the slide changes during the import reached the screen within a frame (17 ms)',
      percentile(during, 0.5) <= 17,
      `median ${percentile(during, 0.5)} ms`,
    );
    check(
      '9 in 10 within two frames (34 ms)',
      percentile(during, 0.9) <= 34,
      `p90 ${percentile(during, 0.9)} ms`,
    );
    const slow = during.filter((ms) => ms > 100).length;
    check(
      'no more than 2% took over 100 ms',
      slow <= Math.max(1, Math.floor(during.length * 0.02)),
      `${slow} of ${during.length}`,
    );
    return { passed: checks.every((c) => c.ok), checks, summary };
  } finally {
    undo();
    rmSync(folder, { recursive: true, force: true });
  }
}
