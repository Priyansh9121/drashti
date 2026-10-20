import type { BrowserWindow } from 'electron';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ELDHistogram } from 'node:perf_hooks';
import type { DrashtiBridge } from '../shared/bridge';
import type { GpuPipelines, MainWatch, PerfProfile } from './perf-watch';
import type { ScenarioRun } from './perf-scenarios';
import { describePriority } from './priority';
import { plural } from '../shared/text';

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
  /**
   * The operator window's first drawing, before anything is measured (Session 26h): when it came, and its
   * slowest slide change. One line of its own, for the record; never judged.
   */
  coldStart?: string;
  /** Every slide change measured, as it went (Sessions 31–36, PERF-2): kept as JSON by the workflow. */
  raw?: RawChange[];
}

/**
 * One slide change, as it went (ms since the epoch, this computer's clock): the operator window sent it
 * (key), the main process sent it on (main), the output drew it into the page, its frame, and the frame
 * after. Main's, the page's and the frames' are those of the change's own revision, when it was painted
 * as itself (two changes in one frame paint the later one only).
 */
export interface RawChange {
  rev: number;
  during: boolean;
  after: boolean;
  keyAt: number;
  mainAt: number | null;
  committedAt: number | null;
  paintedAt: number | null;
  nextAt: number | null;
}

/** An output's paint log entry, as the check reads it. */
export interface PaintRecord {
  rev: number;
  sentAt: number;
  committedAt?: number;
  paintedAt: number;
  nextAt?: number;
}

/** Each change with its own revision's times, from the output's paint log. */
export function rawChanges(
  samples: readonly { rev: number; sentAt: number; during: boolean; after: boolean }[],
  paints: readonly PaintRecord[],
): RawChange[] {
  return samples.map((s) => {
    const own = paints.find((p) => p.rev === s.rev);
    return {
      rev: s.rev,
      during: s.during,
      after: s.after,
      keyAt: s.sentAt,
      mainAt: own?.sentAt ?? null,
      committedAt: own?.committedAt ?? null,
      paintedAt: own?.paintedAt ?? null,
      nextAt: own?.nextAt ?? null,
    };
  });
}

/** The hot path's segments (Sessions 31–36, PERF-2): key to main, main to frame, frame to the next. */
export function segmentsLine(changes: readonly RawChange[]): string {
  const of = (f: (c: RawChange) => number | null) =>
    changes.map(f).filter((v): v is number => v !== null && Number.isFinite(v));
  const keyToMain = of((c) => (c.mainAt === null ? null : c.mainAt - c.keyAt));
  const mainToFrame = of((c) => (c.mainAt === null || c.paintedAt === null ? null : c.paintedAt - c.mainAt));
  const frameToNext = of((c) => (c.paintedAt === null || c.nextAt === null ? null : c.nextAt - c.paintedAt));
  const r = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 10) / 10) : '-');
  const part = (label: string, v: number[]) =>
    `${label} n=${String(v.length)} median ${r(percentile(v, 0.5))}, p95 ${r(percentile(v, 0.95))}, p99 ${r(percentile(v, 0.99))}`;
  return `segments (ms): ${part('key to main', keyToMain)}; ${part('main to frame', mainToFrame)}; ${part('frame to the next', frameToNext)}`;
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
  /** The priority Drashti started at, and its other processes' (Session 17: the mandir PC starts it at normal). */
  priority?: { started: string; others: () => string };
}

/** How big the test import is. */
export const PERF_SONGS = 400;
/**
 * The longest the main process may go without a turn while measured (Session 15). Windows runners
 * stay under 25 ms with the music on or off; CI's Mac runners reach 60 to 110 ms on a slow day.
 */
export const MAX_BLOCK_MS = 150;
const VERSES = 16;

/** A quiet second: the main process's worst turn in it, at most (ms). */
const QUIET_BLOCK_MS = 40;
/** How long the main process is quiet before the measuring begins (ms). */
const QUIET_FOR_MS = 1000;
/** The longest the check waits to settle (ms): then it measures anyway, and says so. */
const SETTLE_LIMIT_MS = 20_000;

export interface Settled {
  settled: boolean;
  /** How long it waited (ms). */
  ms: number;
  /** When every output had warmed up, ms into the wait; null if one never did. */
  warmedAt: number | null;
  /** The main process's worst turn in each second it waited for quiet (ms). */
  worst: number[];
}

export interface SettleProbe {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** How many of the outputs are still warming up. */
  warming: () => Promise<number>;
  /** The main process's worst turn since `reset` (the check's watch on it). */
  quiet: { reset: () => void; worst: () => number };
}

/**
 * Where both sides of a Performance pair start measuring (Sessions 31–36): once every output opened for the
 * check has warmed up and the main process has had a quiet second, or after 20 s whatever. Before, the
 * measuring began the moment the output's fonts were ready, wherever the computer was in settling, so one
 * side of a pair could count its settling in its worst block and the other not.
 */
export async function settle(probe: SettleProbe): Promise<Settled> {
  const from = probe.now();
  const waited = () => probe.now() - from;
  let warmedAt: number | null = null;
  const worst: number[] = [];
  while (waited() < SETTLE_LIMIT_MS) {
    if (warmedAt === null) {
      if ((await probe.warming()) > 0) {
        await probe.sleep(100);
        continue;
      }
      warmedAt = waited();
    }
    probe.quiet.reset();
    await probe.sleep(QUIET_FOR_MS);
    const turn = probe.quiet.worst();
    worst.push(turn);
    if (turn <= QUIET_BLOCK_MS) return { settled: true, ms: waited(), warmedAt, worst };
  }
  return { settled: false, ms: waited(), warmedAt, worst };
}

/** Where the measuring began, for the summary. */
export function settleLine(s: Settled): string {
  const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const turns = s.worst.length > 0 ? ` (its worst turn each second: ${s.worst.join(', ')} ms)` : '';
  if (s.settled)
    return `measuring began once settled, ${secs(s.ms)} after the outputs were ready: they warmed up at ${secs(s.warmedAt ?? 0)}, then the main process was quiet for a second${turns}`;
  if (s.warmedAt === null)
    return `measuring began unsettled, after ${secs(s.ms)}: an output was still warming up`;
  return `measuring began unsettled, after ${secs(s.ms)}: the outputs warmed up at ${secs(s.warmedAt)}, but the main process was never quiet for a second${turns}`;
}

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
 * Whether the import was too quick to owe the overlap (Session 17): it
 * overlapped fewer slide changes than the check asks for, and lasted less
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
  /** Made after a quick import, until five were made from its start (a scenario; Session 17). */
  after: boolean;
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
  slides: { presentationId: string | null; everyMs: number; count?: number } | null,
  edits: boolean,
) {
  const d = (globalThis as unknown as { drashti: DrashtiBridge }).drashti;
  const id =
    slides?.presentationId ??
    (await d.library.listPresentations()).find((p) => p.name === 'Language test slides')?.id ??
    '';
  const every = slides?.everyMs ?? 40;
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const samples: { rev: number; sentAt: number; during: boolean; after: boolean }[] = [];
  let slide = 0;
  const change = async (during: boolean, after = false) => {
    slide = (slide + 1) % (slides?.count ?? 3);
    const sentAt = Date.now();
    const r = await d.engine.dispatch({ type: 'goLive', presentationId: id, slideIndex: slide });
    if (r.ok && r.changed) samples.push({ rev: r.rev, sentAt, during, after });
  };
  // With slides that change every few seconds (a scenario), fewer before the import begins. A scenario at
  // the plain check's pace (enhanced pictures, Session 26f) warms up as the plain check does: 25 changes,
  // which on CI's Macs are slow at first however light the slides.
  const sabhaPace = slides !== null && slides.everyMs >= 1000;
  for (let i = 0; i < (sabhaPace ? 5 : 25); i++) {
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
  const state = { finished: false, finishedAt: 0 };
  const startedAt = Date.now();
  // With no import (to compare), the same changes for a set time.
  const imported =
    folder === null
      ? wait(forMs).then(() => {
          state.finished = true;
          state.finishedAt = Date.now();
          return { ok: true, run: { totals: { failed: 0, imported: 0 } } };
        })
      : d.library.importPaths([folder]).then((result) => {
          state.finished = true;
          state.finishedAt = Date.now();
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
  // With slides every few seconds (a scenario), a quick import is over before enough changes came to
  // judge by: they go on after it at the same pace until five have been made since it began (Session 17).
  const since = () => samples.filter((s) => s.during || s.after).length;
  for (let tries = 0; sabhaPace && since() < 5 && tries < 10; tries++) {
    await change(false, true);
    await wait(every);
  }
  const result = await imported;
  // When the import itself finished: the loop above sees it only after its wait.
  const importMs = state.finishedAt - startedAt;
  await editing;
  return { samples, result, importMs, edits: editSamples };
}

/** The operator window's first drawing, as its page saw it (each time on this computer's clock, or null). */
export interface ColdStart {
  /** The window had opened, settled (`data-opened`). */
  openedAt: number | null;
  /** The presentation was open in the middle of the window. */
  presentationAt: number | null;
  /** The LIVE picture had warmed the GPU up (Session 27, render/WarmUp.tsx), as before a show's first slide. */
  warmedAt: number | null;
  /** Its first slide was on LIVE. */
  liveAt: number | null;
  /** The last slide change was drawn, and two frames after it. */
  settledAt: number | null;
  /** Each slide change, from asking until the LIVE picture drew it (ms). */
  changes: number[];
  /** What stopped it short, if anything. */
  note: string;
}

/** How many slide changes the window's first drawing makes, and how often. */
const COLD_CHANGES = 10;
const COLD_EVERY_MS = 40;

/**
 * Runs in the operator page before the test output covers it (Session 26h): the window opens as it does
 * on a mandir computer before a sabha, with a presentation open in the middle and its slides going up on
 * LIVE, so its first drawing is done before anything is measured, as it is before a show. Each slide
 * change is timed until the LIVE picture drew it: the frame in which the page first shows it. Kept free of
 * anything outside it, as it is sent to the page as source.
 */
async function openAsAShowDoes(name: string, count: number, everyMs: number): Promise<ColdStart> {
  // The page as this uses it (the main process has no DOM types).
  const page = globalThis as unknown as {
    drashti: DrashtiBridge;
    document: {
      documentElement: { dataset: { opened?: string } };
      fonts: { ready: Promise<unknown> };
      querySelector(selector: string): { getAttribute(name: string): string | null } | null;
      querySelectorAll(selector: string): Iterable<{ textContent: string | null; click(): void }>;
    };
    requestAnimationFrame(callback: () => void): number;
  };
  const d = page.drashti;
  const doc = page.document;
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  // The next frame (the window is on view, so it draws them), or 100 ms if none comes.
  const frame = () =>
    new Promise<void>((resolve) => {
      const late = setTimeout(resolve, 100);
      page.requestAnimationFrame(() => {
        clearTimeout(late);
        resolve();
      });
    });
  const until = async (seen: () => boolean, ms: number): Promise<number | null> => {
    const end = Date.now() + ms;
    for (;;) {
      if (seen()) return Date.now();
      if (Date.now() > end) return null;
      await frame();
    }
  };
  const out: ColdStart = {
    openedAt: null,
    presentationAt: null,
    warmedAt: null,
    liveAt: null,
    settledAt: null,
    changes: [],
    note: '',
  };
  const notes: string[] = [];
  // The window drawn (the library's list, or since Session 44 the Library button over the playlists); it has
  // opened, settled, within a second after it (an older Drashti, the paired check's base, never says so).
  await until(
    () =>
      doc.querySelector('[data-testid="presentation-row"]') !== null ||
      doc.querySelector('[data-testid="library-button"]') !== null,
    30_000,
  );
  out.openedAt = await until(() => doc.documentElement.dataset.opened !== undefined, 3000);
  if (out.openedAt === null) notes.push('the window never said it had opened (data-opened)');
  await doc.fonts.ready;
  // The library as an operator opens it (Session 44: a sheet, shut until the Library button opens it).
  if (doc.querySelector('[data-testid="presentation-row"]') === null)
    for (const button of doc.querySelectorAll('[data-testid="library-button"]')) button.click();
  await until(() => doc.querySelector('[data-testid="presentation-row"]') !== null, 10_000);
  const id = (await d.library.listPresentations()).find((p) => p.name === name)?.id ?? '';
  const row = [...doc.querySelectorAll('[data-testid="presentation-row"]')].find((r) =>
    (r.textContent ?? '').startsWith(name),
  );
  if (!id || !row) {
    out.note = [...notes, `no “${name}” in the library list`].join('; ');
    return out;
  }
  row.click();
  out.presentationAt = await until(
    () =>
      doc.querySelector(
        `[data-testid="slide-grid"][data-presentation-id="${id}"] [data-testid="slide-thumb"]`,
      ) !== null,
    10_000,
  );
  // As before a show: the LIVE picture warms the GPU up before the first slide goes live (a slide up first
  // stops it at once, and CI's Mac then made the LIVE picture's own pipelines in the first Bold transition).
  out.warmedAt = await until(
    () => doc.querySelector('[data-testid="live-preview"] [data-warm-up]') === null,
    10_000,
  );
  if (out.warmedAt === null) notes.push('the LIVE picture was still warming up after 10 s');
  const live = () =>
    doc
      .querySelector('[data-testid="live-preview"] [data-slide-in] [data-slide]')
      ?.getAttribute('data-slide') ?? null;
  for (let i = 0; i < count; i++) {
    const before = live();
    const askedAt = Date.now();
    const r = await d.engine.dispatch({ type: 'goLive', presentationId: id, slideIndex: i % 3 });
    if (!r.ok) {
      notes.push('a slide change was refused');
      break;
    }
    const drawn = await until(() => {
      const now = live();
      return now !== null && now !== before;
    }, 5000);
    if (drawn === null) {
      notes.push('LIVE did not show a slide change within 5 s');
      break;
    }
    out.liveAt ??= drawn;
    out.changes.push(drawn - askedAt);
    await wait(everyMs);
  }
  await frame();
  await frame();
  out.settledAt = Date.now();
  out.note = notes.join('; ');
  return out;
}

/** The cold start's line: each step's time after Drashti started, and its slide changes (Session 26h). */
export function coldStartLine(cold: ColdStart, startedAt: number): string {
  const at = (t: number | null) => (t === null ? 'never' : `${((t - startedAt) / 1000).toFixed(1)} s`);
  const changes = cold.changes;
  const told =
    changes.length === 0
      ? 'no slide changes drawn'
      : `its slide changes, to the LIVE picture: n=${changes.length} median ${percentile(changes, 0.5)} ms, slowest ${Math.max(...changes)} ms`;
  return `cold start (not judged): the operator window opened settled ${at(cold.openedAt)} after Drashti started, a presentation open at ${at(cold.presentationAt)}, the LIVE picture warmed up at ${at(cold.warmedAt)}, LIVE showing at ${at(cold.liveAt)}, all drawn at ${at(cold.settledAt)}; ${told}${cold.note ? ` (${cold.note})` : ''}`;
}

/** The GPU's pipelines in words (a trace kept; Session 27). */
export function gpuLine(gpu: GpuPipelines): string {
  const names: Record<string, string> = {
    live: 'the LIVE picture',
    output: 'the test output',
    stream: 'the stream’s page',
  };
  const warm = gpu.warmUps
    .map(
      (w) =>
        `${String(w.made)} as ${names[w.page] ?? w.page} warmed up (${String(w.ms)} ms; ${w.took === null ? 'still going' : `${String(w.took)} ms`}${w.how === 'drawn' || w.how === '' ? '' : `, ${w.how === 'cut' ? 'cut short' : w.how === 'cap' ? 'at its longest' : 'not seen'}`})`,
    )
    .join(', ');
  return `the GPU made ${plural(gpu.made, 'new pipeline')} (${String(gpu.ms)} ms)${warm ? `, ${warm}` : ''}${gpu.between === null ? '' : `, ${String(gpu.between)} between the test output's and the first Bold transition`}${gpu.during ? `, ${String(gpu.during.length)} during the first Bold transition` : ''}`;
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
  return `main process worst block ${watch.worstBlockMs()} ms, ${(watch.worstBlockAt() / 1000).toFixed(1)} s into the measuring, gaps over 100 ms: ${watch.gaps.length}${told.length > 0 ? ` (${told.join(' | ')})` : ''}`;
}

const js = <T>(win: BrowserWindow, code: string) =>
  win.webContents.executeJavaScript(code, true) as Promise<T>;

/**
 * The operator window's first drawing, on view (Session 26h): before, the test output covered the window
 * from the start, so it drew its first frames only once the slide changes began, and that first drawing
 * (on CI's Mac, each new kind of drawing compiled for the graphics chip while every window waits) was
 * measured as if it were the show's. On a mandir computer the window has long been drawn by then.
 */
async function coldStart(operator: BrowserWindow | null, startedAt: number): Promise<string> {
  if (!operator || operator.isDestroyed()) return 'cold start (not judged): no operator window';
  try {
    const cold = await js<ColdStart>(
      operator,
      `(${openAsAShowDoes.toString()})(${JSON.stringify(PERF_PRESENTATION)}, ${String(COLD_CHANGES)}, ${String(COLD_EVERY_MS)})`,
    );
    return coldStartLine(cold, startedAt);
  } catch (error) {
    return `cold start (not judged): it stopped (${String(error)})`;
  }
}

/** The placeholder presentation the check's slides come from (seeded in every new library). */
const PERF_PRESENTATION = 'Language test slides';

export async function runPerformanceTest(ctx: PerfContext): Promise<PerfResult> {
  const checks: PerfCheck[] = [];
  const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });
  // Drashti's start, on this computer's clock (the operator page's times are on it too).
  const startedAt = Date.now() - Math.round(process.uptime() * 1000);
  // A trace (DRASHTI_PERF_PROFILE) from the start: the LIVE picture's GPU warm-up, the cold start and the
  // test output's warm-up are in it too.
  await ctx.profile?.start();
  // The window draws first, on view, as before a show; then the test output goes over it.
  const cold = await coldStart(ctx.operator(), startedAt);
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
      return { passed: false, checks, summary: '', coldStart: cold };
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
    await ctx.scenario?.begin();
    // Both sides of a pair start measuring at the same settled point (Sessions 31–36).
    const settled = await settle({
      now: () => Date.now(),
      sleep,
      warming: async () =>
        (
          await Promise.all(
            ctx
              .outputs()
              .map((w) =>
                w.isDestroyed()
                  ? Promise.resolve('')
                  : js<string>(
                      w,
                      `document.querySelector('[data-testid="output-root"]')?.dataset.warmUp ?? ''`,
                    ).catch(() => ''),
              ),
          )
        ).filter((state) => state === 'warming').length,
      quiet: { reset: () => ctx.watch?.reset(), worst: () => ctx.watch?.worstBlockMs() ?? 0 },
    });
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
    // With a trace: the GPU's new pipelines while it ran, and during the first Bold transition (Session 27).
    const gpu = (await ctx.profile?.pipelines().catch(() => null)) ?? null;
    if (!operator.isDestroyed()) operator.webContents.setBackgroundThrottling(true);
    const loopP99 = Math.round(d.loopDelay.percentile(99) / 1e6);
    const loopMax = Math.round(d.loopDelay.max / 1e6);
    const slowest = [...d.handlerTimes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([channel, ms]) => `${channel} ${Math.round(ms)}`);

    // Pair each change with the first frame the output painted at or after its revision.
    await sleep(200);
    const paints = await js<PaintRecord[]>(shown, 'globalThis.drashtiPaintLog ?? []');
    const raw = rawChanges(run.samples, paints);
    const latency = (s: Sample) => (paints.find((p) => p.rev >= s.rev)?.paintedAt ?? Infinity) - s.sentAt;
    const idle = run.samples.filter((s) => !s.during && !s.after).map(latency);
    const during = run.samples.filter((s) => s.during).map(latency);
    const after = run.samples.filter((s) => s.after).map(latency);
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
      ? `; the import’s commits: ${String(commits)}, ${String(Math.round(t?.commit ?? 0))} ms in all${commits > 0 ? ` (${String(Math.round((t?.commit ?? 0) / commits))} ms each)` : ''}; import gave way ${ways ? JSON.stringify(ways) : '?'}; operator's edits ${editLine(
          'idle',
          run.edits.filter((e) => !e.during),
        )}; ${editLine(
          'importing',
          run.edits.filter((e) => e.during),
        )} (${(['words', 'playlist', 'theme'] as const).map((k) => `${k} worst ${Math.max(0, ...run.edits.filter((e) => e.during && e.kind === k).map((e) => Math.round(e.ms)))} ms`).join(', ')})`
      : '';
    const others = ctx.priority?.others();
    const priority = `main process priority ${describePriority()}${ctx.priority ? ` (started at ${ctx.priority.started}${others ? `, its other processes ${others}` : ''})` : ''}`;
    const summary = `${what}; ${settleLine(settled)}${editsSummary}; ${priority}; ${line('idle', idle)}; ${line(noImport ? 'changing' : 'importing', during)}${after.length > 0 ? `; ${line('just after the import', after)}` : ''}; ${segmentsLine(raw)}; main event loop delay p99 ${loopP99} ms, max ${loopMax} ms; slowest handlers (ms) ${slowest.join(', ')}; longest GC ${Math.round(d.gc.max)} ms${ctx.watch ? `; ${watchSummary(ctx.watch)}` : ''}${cpu === undefined ? '' : `; Drashti's processes used ${String(Math.round(cpu))}% of one core`}${scenario ? `; ${scenario.summary}` : ''}${gpu ? `; ${gpuLine(gpu)}` : ''}`;

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
    // and on a quick computer only the first (Session 17): the overlap is owed only if the import lasted
    // long enough, at the pace the slides kept before it.
    const pace = paceOf(
      run.samples.filter((s) => !s.during && !s.after).map((s) => s.sentAt),
      ctx.scenario?.slides.everyMs ?? 40,
    );
    const wanted = ctx.scenario && ctx.scenario.slides.everyMs >= 1000 ? 2 : 10;
    checks.push(overlapCheck(during.length, run.importMs, wanted, pace));
    // The changes from the import's start: those during it, and, when a quick one was over before five
    // came (a scenario's slides change every 2 s), the next ones after it, under the same load on the
    // screens (Session 17). One change, sent as the import began, would otherwise decide the lines.
    const judged = [...during, ...after];
    const which =
      after.length > 0
        ? `, ${String(judged.length)} changes from the import’s start, ${String(after.length)} after it`
        : '';
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
    if (gpu?.during)
      check(
        'the GPU made no new pipeline during the first Bold transition (the screens warmed it up)',
        gpu.during.length === 0,
        gpu.during.slice(0, 6).join(' | '),
      );
    // Session 15: the main process carries every slide change; a block stops them all.
    if (ctx.watch)
      check(
        `the main process never went more than ${String(MAX_BLOCK_MS)} ms without a turn`,
        ctx.watch.worstBlockMs() <= MAX_BLOCK_MS,
        `worst ${String(ctx.watch.worstBlockMs())} ms`,
      );
    return { passed: checks.every((c) => c.ok), checks, summary, coldStart: cold, raw };
  } finally {
    undo();
    rmSync(folder, { recursive: true, force: true });
  }
}
