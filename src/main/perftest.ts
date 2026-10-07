import type { BrowserWindow } from 'electron';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ELDHistogram } from 'node:perf_hooks';
import type { DrashtiBridge } from '../shared/bridge';
import type { MainWatch, PerfProfile } from './perf-watch';
import type { ScenarioRun } from './perf-scenarios';
import { describePriority } from './priority';

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
  /** Every main-process gap over 100 ms, beside what was going on (Session 15). */
  watch?: MainWatch;
  /** A CPU profile and a Chromium trace, kept in a folder (DRASHTI_PERF_PROFILE). */
  profile?: PerfProfile;
  /** Slide changes for this long with no import (DRASHTI_PERF_NO_IMPORT=1), to tell the import's share. */
  noImportMs?: number;
  /** Something to start this long into the measured part (the sound, DRASHTI_PERF_MUSIC_LATE=1). */
  during?: { afterMs: number; what: string; run(): void };
  /** A heavy case (DRASHTI_PERF_SCENARIO; Session 15): its own load on the screens, and its checks. */
  scenario?: ScenarioRun;
  /** Processor used by all of Drashti's processes since asked before (percent of one core). */
  cpu?: () => number;
  /**
   * An operator's edits meanwhile (DRASHTI_PERF_EDITS=1; Session 16): the words of a presentation,
   * a playlist's name and a theme in turn, every 0.7 s, timed from the operator window.
   */
  edits?: boolean;
  /** How the import gave way to those edits (the import service's counts). */
  wayStats?: () => Record<string, number>;
  /** How many files to import (DRASHTI_PERF_SONGS; PERF_SONGS unless asked): a slower or quicker import, to try the rules. */
  songs?: number;
}

/** How big the test import is. */
export const PERF_SONGS = 400;
/**
 * The longest the main process may go without a turn while measured (Session 15). Windows runners
 * stay under 25 ms with the music on or off; CI's Mac runners reach 60 to 110 ms on a slow day.
 */
export const MAX_BLOCK_MS = 150;
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

/** How often the slides really changed: the median time between changes sent one after another. */
export function paceOf(sentAts: readonly number[], everyMs: number): number {
  const gaps = sentAts.slice(1).map((at, i) => at - (sentAts[i] ?? at));
  return gaps.length > 0 ? Math.max(everyMs, percentile(gaps, 0.5)) : everyMs;
}

/**
 * Whether the import was too quick to judge the slide changes by (Session
 * 17): it overlapped fewer of them than the check asks for, and lasted less
 * than that many take at the pace the slides kept before it. CI's Mac brings
 * in the 400 files in about a second while the video cases change slides
 * every 2 s, so only the change sent as the import began came during it.
 */
export function quickImport(during: number, importMs: number, wanted: number, paceMs: number): boolean {
  return during < wanted && importMs < wanted * paceMs;
}

/**
 * Whether the slides kept changing all through the import (Session 17). The
 * import must overlap at least `wanted` slide changes, but only if it lasted
 * as long as that many take: a quick computer is quick, not failing. A longer
 * import that overlaps fewer means the changes stopped while it ran, which is
 * what this checks.
 */
export function overlapCheck(during: number, importMs: number, wanted: number, paceMs: number): PerfCheck {
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const quick = quickImport(during, importMs, wanted, paceMs);
  return {
    name: `the import overlapped at least ${String(wanted)} slide changes (if it lasted ${seconds(wanted * paceMs)} or more)`,
    ok: quick || during >= wanted,
    detail: `${String(during)} in ${seconds(importMs)}${quick ? `, quicker than ${String(wanted)} changes take: nothing to judge` : ''}`,
  };
}

interface Sample {
  rev: number;
  sentAt: number;
  during: boolean;
}

/** An operator's edit, as long as it took from the operator window. */
interface EditSample {
  kind: 'words' | 'playlist' | 'theme';
  ms: number;
  during: boolean;
  ok: boolean;
}

/**
 * Runs in the operator page: change slides every 40 ms, first with nothing
 * else going on, then all through an import of `folder`. Kept free of
 * anything outside it, as it is sent to the page as source.
 */
async function slideChangesDuringImport(
  folder: string | null,
  forMs: number,
  slides: { presentationId: string | null; everyMs: number } | null,
  edits: boolean,
) {
  const d = (globalThis as unknown as { drashti: DrashtiBridge }).drashti;
  const id =
    slides?.presentationId ??
    (await d.library.listPresentations()).find((p) => p.name === 'Language test slides')?.id ??
    '';
  const every = slides?.everyMs ?? 40;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const samples: { rev: number; sentAt: number; during: boolean }[] = [];
  let slide = 0;
  const change = async (during: boolean) => {
    slide = (slide + 1) % 3;
    const sentAt = Date.now();
    const r = await d.engine.dispatch({ type: 'goLive', presentationId: id, slideIndex: slide });
    if (r.ok && r.changed) samples.push({ rev: r.rev, sentAt, during });
  };
  // With slides that change every few seconds (a scenario), fewer before the import begins.
  for (let i = 0; i < (slides ? 5 : 25); i++) {
    await change(false);
    await wait(every);
  }
  // An operator's edits (Session 16): the other placeholder presentation's words, a playlist's
  // name and the default theme in turn, each changed back and forth so every save writes.
  const editSamples: { kind: 'words' | 'playlist' | 'theme'; ms: number; during: boolean; ok: boolean }[] =
    [];
  const wordsId = (await d.library.listPresentations()).find((p) => p.id !== id)?.id ?? '';
  const words = edits ? await d.library.words(wordsId) : null;
  const made = edits ? await d.playlists.create('Placeholder edits', null, false) : null;
  const playlistId = made?.ok ? (made.ids[0] ?? '') : '';
  const themes = edits ? await d.themes.list() : null;
  const theme = themes?.themes.find((t) => t.id === themes.defaultId) ?? null;
  let editCount = 0;
  const editOnce = async (during: boolean) => {
    const n = editCount++;
    const kind = (['words', 'playlist', 'theme'] as const)[n % 3] ?? 'words';
    const t0 = performance.now();
    let ok = false;
    if (kind === 'words' && words?.ok)
      ok = (await d.library.saveWords(wordsId, `${words.text}\n\nPlaceholder edit ${String(n % 2)}`)).ok;
    else if (kind === 'playlist' && playlistId)
      ok = (await d.playlists.rename(playlistId, `Placeholder edits ${String(n)}`)).ok;
    else if (kind === 'theme' && theme) {
      const { id: themeId, ...fields } = theme;
      ok = (await d.themes.save(themeId, { ...fields, name: `${theme.name}${n % 2 ? ' ' : ''}` })).ok;
    }
    editSamples.push({ kind, ms: performance.now() - t0, during, ok });
  };
  if (edits)
    for (let i = 0; i < 6; i++) {
      await editOnce(false);
      await wait(300);
    }
  const state = { finished: false };
  const startedAt = Date.now();
  // With no import (to compare), the same changes for a set time.
  const imported =
    folder === null
      ? wait(forMs).then(() => {
          state.finished = true;
          return { ok: true, run: { totals: { failed: 0, imported: 0 } } };
        })
      : d.library.importPaths([folder]).then((result) => {
          state.finished = true;
          return result;
        });
  // The import finishing is seen after each wait (the narrowing of `state` would not see it).
  const importing = () => !state.finished;
  const editing = (async () => {
    while (edits && importing()) {
      await wait(700);
      if (importing()) await editOnce(true);
    }
  })();
  while (!state.finished) {
    await change(true);
    await wait(every);
  }
  const result = await imported;
  const importMs = Date.now() - startedAt;
  await editing;
  return { samples, result, importMs, edits: editSamples };
}

/** The main process's worst block and its gaps over 100 ms, each with what went on around it (at most 6). */
export function watchSummary(watch: MainWatch): string {
  const gaps = [...watch.gaps].sort((a, b) => b.ms - a.ms).slice(0, 6);
  const told = gaps.map((g) => {
    const near = watch
      .near(g)
      .slice(0, 8)
      .map((e) => `${e.what}${e.ms === undefined ? '' : ` ${e.ms} ms`} @${e.at}`);
    return `${g.ms} ms at ${g.at} ms${near.length > 0 ? ` [${near.join('; ')}]` : ''}`;
  });
  return `main process worst block ${watch.worstBlockMs()} ms, gaps over 100 ms: ${watch.gaps.length}${told.length > 0 ? ` (${told.join(' | ')})` : ''}`;
}

const js = <T>(win: BrowserWindow, code: string) =>
  win.webContents.executeJavaScript(code, true) as Promise<T>;

export async function runPerformanceTest(ctx: PerfContext): Promise<PerfResult> {
  const checks: PerfCheck[] = [];
  const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });
  const folder = mkdtempSync(join(tmpdir(), 'drashti-perf-lyrics-'));
  const songs = ctx.songs ?? PERF_SONGS;
  const undo = await ctx.ensureOutput();
  try {
    if (ctx.noImportMs === undefined)
      for (let i = 1; i <= songs; i++) {
        writeFileSync(
          join(folder, `Placeholder Song ${String(i).padStart(Math.max(3, String(songs).length), '0')}.txt`),
          song(i),
        );
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
    const noImport = ctx.noImportMs !== undefined;
    await ctx.profile?.start();
    await ctx.scenario?.begin();
    ctx.cpu?.();
    d.loopDelay.reset();
    d.handlerTimes.clear();
    d.gc.max = 0;
    ctx.watch?.reset();
    ctx.watch?.note(noImport ? 'slide changes begin (no import)' : 'slide changes begin');
    const midway = ctx.during;
    const later = midway
      ? setTimeout(() => {
          ctx.watch?.note(midway.what);
          midway.run();
        }, midway.afterMs)
      : null;
    const running = js<{
      samples: Sample[];
      result: {
        ok: boolean;
        message?: string;
        run?: { totals: { failed: number; imported: number } };
        timings?: { commit: number; commits?: number; write: number; total: number };
      };
      importMs: number;
      edits: EditSample[];
    }>(
      operator,
      `(${slideChangesDuringImport.toString()})(${JSON.stringify(noImport ? null : folder)}, ${String(ctx.noImportMs ?? 0)}, ${JSON.stringify(ctx.scenario?.slides ?? null)}, ${String(ctx.edits === true)})`,
    );
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
    if (later) clearTimeout(later);
    const cpu = ctx.cpu?.();
    const scenario = await ctx.scenario?.end();
    ctx.watch?.note('slide changes end');
    await ctx.profile?.stop(ctx.watch ?? null);
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
    const what = noImport
      ? `no import: slide changes for ${run.importMs} ms`
      : `import of ${String(songs)} files took ${run.importMs} ms`;
    const editLine = (label: string, v: EditSample[]) => {
      const ms = v.map((e) => Math.round(e.ms));
      return v.length === 0
        ? `${label}: none`
        : `${label}: n=${v.length} median ${percentile(ms, 0.5)} ms, p90 ${percentile(ms, 0.9)} ms, worst ${Math.max(...ms)} ms${v.some((e) => !e.ok) ? ` (${v.filter((e) => !e.ok).length} failed)` : ''}`;
    };
    const ways = ctx.wayStats?.();
    const t = run.result.timings;
    const commits = t?.commits ?? 0;
    const editsSummary = ctx.edits
      ? `; the import's commits: ${String(commits)}, ${String(Math.round(t?.commit ?? 0))} ms in all${commits > 0 ? ` (${String(Math.round((t?.commit ?? 0) / commits))} ms each)` : ''}; import gave way ${ways ? JSON.stringify(ways) : '?'}; operator's edits ${editLine(
          'idle',
          run.edits.filter((e) => !e.during),
        )}; ${editLine(
          'importing',
          run.edits.filter((e) => e.during),
        )} (${(['words', 'playlist', 'theme'] as const).map((k) => `${k} worst ${Math.max(0, ...run.edits.filter((e) => e.during && e.kind === k).map((e) => Math.round(e.ms)))} ms`).join(', ')})`
      : '';
    const summary = `${what}${editsSummary}; main process priority ${describePriority()}; ${line('idle', idle)}; ${line(noImport ? 'changing' : 'importing', during)}; main event loop delay p99 ${loopP99} ms, max ${loopMax} ms; slowest handlers (ms) ${slowest.join(', ')}; longest GC ${Math.round(d.gc.max)} ms${ctx.watch ? `; ${watchSummary(ctx.watch)}` : ''}${cpu === undefined ? '' : `; Drashti's processes used ${String(Math.round(cpu))}% of one core`}${scenario ? `; ${scenario.summary}` : ''}`;

    const totals = run.result.run?.totals;
    if (!noImport) {
      check('the import ran in its own process', sawWorker);
      check(
        'the import finished without failures',
        run.result.ok && totals?.failed === 0 && totals.imported === songs,
        run.result.ok
          ? `${totals?.imported ?? 0} imported, ${totals?.failed ?? 0} failed`
          : (run.result.message ?? ''),
      );
    }
    // A scenario's slides change every two seconds, as in a sabha, so few of them overlap the import,
    // and on a quick computer none but the first (Session 17): its own figures are the video's frames
    // and the blocks. The pace is the one the slides kept before the import.
    const pace = paceOf(
      run.samples.filter((s) => !s.during).map((s) => s.sentAt),
      ctx.scenario?.slides.everyMs ?? 40,
    );
    const wanted = ctx.scenario ? 2 : 10;
    checks.push(overlapCheck(during.length, run.importMs, wanted, pace));
    // A quick import overlaps too few changes to judge by (one, sent as it began, would decide the
    // median alone): then the lines below judge every measured change, before the import and during
    // it, under the same load on the screens, and say so.
    const quick = quickImport(during.length, run.importMs, wanted, pace);
    const judged = quick ? [...idle, ...during] : during;
    const which = quick ? ` (all ${String(judged.length)} changes: the import was quick)` : '';
    // 60 Hz: a frame is 16.7 ms. (No change during a long import at all: the line above says why.)
    const none = judged.length === 0;
    check(
      'half the slide changes during the import reached the screen within a frame (17 ms)',
      none || percentile(judged, 0.5) <= 17,
      none ? 'none during the import' : `median ${percentile(judged, 0.5)} ms${which}`,
    );
    check(
      '9 in 10 within two frames (34 ms)',
      none || percentile(judged, 0.9) <= 34,
      none ? 'none during the import' : `p90 ${percentile(judged, 0.9)} ms${which}`,
    );
    const slow = judged.filter((ms) => ms > 100).length;
    check(
      'no more than 2% took over 100 ms',
      slow <= Math.max(1, Math.floor(judged.length * 0.02)),
      `${slow} of ${judged.length}${which}`,
    );
    if (scenario) checks.push(...scenario.checks);
    // Session 15: the main process carries every slide change; a block stops them all.
    if (ctx.watch)
      check(
        `the main process never went more than ${String(MAX_BLOCK_MS)} ms without a turn`,
        ctx.watch.worstBlockMs() <= MAX_BLOCK_MS,
        `worst ${String(ctx.watch.worstBlockMs())} ms`,
      );
    return { passed: checks.every((c) => c.ok), checks, summary };
  } finally {
    undo();
    rmSync(folder, { recursive: true, force: true });
  }
}
