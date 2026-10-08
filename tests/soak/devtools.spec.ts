import { expect, test } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from '../e2e/helpers';
import {
  killApp,
  launchApp,
  operatorPage,
  outputPages,
  QUIET,
  relaunchApp,
  setUpScreen,
} from '../e2e/helpers';
import { testFfmpeg } from '../e2e/stream-helpers';
import { makeMedia } from './media';

/*
 * The output windows' memory with DevTools attached and without (Session
 * 17). Every soak runs under Playwright, which keeps DevTools attached to
 * each window with its network recorder on, and that recorder keeps what a
 * window loads (Session 16 found it behind the operator window's rise). This
 * runs one show twice on one runner, from the same start: first with
 * Drashti started plainly, nothing attached, then under Playwright as the
 * soak starts it, and compares each window's memory, which Drashti writes to
 * its log every minute (DRASHTI_TEST_MEMORY_EVERY_MS).
 *
 * The show runs by itself, so nothing needs to reach into Drashti: a looping
 * presentation whose slides move on every 6 s, dissolving, bringing video
 * and picture backgrounds as the soak's playlist does, on two outputs.
 * Restart recovery brings it back at each start (Drashti is stopped dead
 * after setting it up, and after the first half). Each half lasts
 * DRASHTI_SOAK_MINUTES (the Soak workflow's minutes; 45 if not set
 * otherwise). Placeholder words and generated media only.
 */

test.skip(QUIET, 'Real windows for an hour and more: runs on CI (the Soak workflow, test devtools)');
test.skip(process.env['DRASHTI_SOAK_DEVTOOLS'] !== '1', 'Only when asked (the Soak workflow, test devtools)');

const HALF_MINUTES = Math.max(4, Number(process.env['DRASHTI_SOAK_MINUTES'] ?? '45') || 45);
const OUT = join(process.cwd(), 'test-results', 'soak');
/** How often Drashti writes each window's memory to its log. */
const EVERY_MS = 60_000;
/** Samples before this are the warm-up, left out of the rates. */
const WARM_MINUTES = Math.min(5, HALF_MINUTES / 4);
const COMMON = {
  DRASHTI_WINDOWED_OUTPUTS: '1',
  DRASHTI_EXTRA_DISPLAYS: '1',
  DRASHTI_TEST_MEMORY_EVERY_MS: String(EVERY_MS),
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface MemorySample {
  at: number;
  windows: Record<string, { ws: number; priv?: number }>;
}

/** Drashti's memory lines, oldest first (every log file: it rotates). */
function memoryLines(userData: string): MemorySample[] {
  const dir = join(userData, 'logs');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^drashti(\.\d+)?\.log$/u.test(f))
    .flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n'))
    .flatMap((line) => {
      const i = line.indexOf('Memory (test): ');
      if (i < 0) return [];
      const at = Date.parse(line.slice(0, 24));
      try {
        const windows = JSON.parse(line.slice(i + 'Memory (test): '.length)) as MemorySample['windows'];
        return Number.isFinite(at) ? [{ at, windows }] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.at - b.at);
}

/** Drashti started plainly, as an operator starts it: no test driver, no DevTools. */
function startPlainly(userData: string): ChildProcess {
  const electron = createRequire(__filename)('electron') as string;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, COMMON, {
    DRASHTI_USER_DATA_DIR: userData,
    DRASHTI_NO_QUIT_CONFIRM: '1',
    DRASHTI_TEST_NO_WIZARD: '1',
    DRASHTI_TEST_QUIET: '0',
    DRASHTI_ROLE: 'main',
  });
  return spawn(electron, ['.'], { env, stdio: 'ignore' });
}

interface Rate {
  first: number;
  last: number;
  /** The least-squares slope after the warm-up, MB an hour. */
  perHour: number;
  /** The median of each quarter of the half, MB; null for a quarter with no sample (a short half's first). */
  quarters: (number | null)[];
}

function rateOf(points: [number, number][]): Rate | null {
  const kept = points.filter(([minute]) => minute >= WARM_MINUTES);
  if (kept.length < 3) return null;
  const n = kept.length;
  const mx = kept.reduce((s, [x]) => s + x, 0) / n;
  const my = kept.reduce((s, [, y]) => s + y, 0) / n;
  const sxy = kept.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0);
  const sxx = kept.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)] ?? null;
  const quarters = [0, 1, 2, 3].map((q) =>
    median(
      points
        .filter(([minute]) => minute >= (q * HALF_MINUTES) / 4 && minute < ((q + 1) * HALF_MINUTES) / 4)
        .map(([, y]) => y),
    ),
  );
  return {
    first: kept[0]?.[1] ?? 0,
    last: kept.at(-1)?.[1] ?? 0,
    perHour: sxx > 0 ? (sxy / sxx) * 60 : 0,
    quarters,
  };
}

const mb = (n: number) => n.toFixed(1);

test('the output windows’ memory, with DevTools attached and without (Session 17)', async () => {
  test.setTimeout((2 * HALF_MINUTES + 30) * 60_000);
  mkdirSync(OUT, { recursive: true });
  const ffmpeg = testFfmpeg();
  expect(ffmpeg, 'the bundled FFmpeg (node scripts/fetch-ffmpeg.mjs)').not.toBeNull();
  const work = mkdtempSync(join(tmpdir(), 'drashti-devtools-'));
  const media = makeMedia(ffmpeg ?? '', work).filter((f) => !f.endsWith('.wav') && !f.endsWith('.txt'));
  const words = join(work, 'Placeholder self-running words.txt');
  writeFileSync(
    words,
    `[Verse]\n${Array.from({ length: 9 }, (_, i) => `Placeholder words, slide ${String(i + 1)}`).join('\n\n')}\n`,
  );

  // ---- the show that runs by itself, set up with the test driver --------------------------------------------
  const { app, userData } = await launchApp(COMMON);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  const presentationId = await win.evaluate(
    async ({ files, words }) => {
      const d = (globalThis as PageGlobals).drashti;
      const r = await d.library.importPaths([...files, words]);
      if (!r.ok) throw new Error(r.message);
      const all = await d.library.listMedia();
      const id = (start: string) => all.find((m) => m.name.startsWith(start))?.id ?? null;
      const [v1, v2, v3, p1, p2] = [
        id('Placeholder soak video 1'),
        id('Placeholder soak video 2'),
        id('Placeholder soak video 3'),
        id('Placeholder soak picture 1'),
        id('Placeholder soak picture 2'),
      ];
      const pres = (await d.library.listPresentations()).find((p) =>
        p.name.startsWith('Placeholder self-running words'),
      );
      if (!pres) throw new Error('the words were not imported');
      const opened = await d.library.slidesForEdit(pres.id);
      if (!opened.ok) throw new Error(opened.message);
      const doc = opened.doc;
      doc.loop = true;
      doc.transition = { kind: 'dissolve', durationMs: 1000 };
      // As the soak's playlist: a video, words, a picture, words, a video, a picture, a video.
      const backgrounds: Record<number, { id: string | null; video: boolean }> = {
        1: { id: v1, video: true },
        3: { id: p1, video: false },
        5: { id: v2, video: true },
        6: { id: p2, video: false },
        8: { id: v3, video: true },
      };
      const slides = doc.groups.flatMap((g) => g.slides);
      if (slides.length < 9) throw new Error(`only ${String(slides.length)} slides`);
      slides.forEach((s, i) => {
        s.autoAdvanceMs = 6000;
        const bg = backgrounds[i];
        if (bg?.id)
          s.cues = [
            {
              id: `new-cue-${String(i)}`,
              kind: 'background',
              label: 'Placeholder background',
              mediaId: bg.id,
              props: JSON.stringify({ fit: 'fill', loop: bg.video }),
            },
          ];
      });
      const saved = await d.library.saveSlides(pres.id, doc, opened.stamp);
      if (!saved.ok) throw new Error(saved.message);
      return pres.id;
    },
    { files: media, words },
  );
  await setUpScreen(win, 'Main Hall', 0);
  await setUpScreen(win, 'Overflow', 1);
  await expect.poll(() => outputPages(app).length).toBe(2);
  await win.evaluate(
    (id) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: id,
        slideIndex: 0,
      }),
    presentationId,
  );
  // It moves on by itself, and the state to bring back is on disk.
  const liveIndex = () =>
    win.evaluate(
      async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.live.slideIndex ?? -1,
    );
  await expect.poll(liveIndex, { timeout: 20_000 }).toBeGreaterThan(1);
  await expect
    .poll(() => {
      const file = join(userData, 'live-state.json');
      return existsSync(file) && readFileSync(file, 'utf8').includes('"autoAdvance":{');
    })
    .toBe(true);
  await killApp(app);
  await sleep(3000);

  // ---- the first half: started plainly, nothing attached ----------------------------------------------------
  const plainFrom = Date.now();
  const plain = startPlainly(userData);
  const plainExit = new Promise<number | null>((resolve) => plain.once('exit', resolve));
  await sleep(HALF_MINUTES * 60_000);
  const plainTo = Date.now();
  const stillRunning = plain.exitCode === null;
  plain.kill('SIGKILL');
  await plainExit;
  await sleep(5000);

  // ---- the second half: under Playwright, as the soak starts it ---------------------------------------------
  const attachedFrom = Date.now();
  const attached = await relaunchApp(userData, COMMON);
  const attachedWin = await operatorPage(attached.app);
  await expect(attachedWin.getByTestId('presentation-list')).toBeVisible();
  await sleep(HALF_MINUTES * 60_000);
  const attachedTo = Date.now();
  const outputsAttached = outputPages(attached.app).length;
  await killApp(attached.app);

  // ---- what it came to ------------------------------------------------------------------------------------
  const lines = memoryLines(userData);
  const half = (from: number, to: number) => lines.filter((l) => l.at >= from && l.at <= to);
  const halves = [
    { name: 'Nothing attached (started plainly)', samples: half(plainFrom, plainTo), from: plainFrom },
    {
      name: 'Playwright attached (as the soak)',
      samples: half(attachedFrom, attachedTo),
      from: attachedFrom,
    },
  ];
  const windows = [...new Set(lines.flatMap((l) => Object.keys(l.windows)))].sort();
  const report: string[] = [
    `## The output windows' memory, with DevTools attached and without (Session 17)`,
    '',
    `${process.platform} ${process.arch}; each half ${String(HALF_MINUTES)} minutes, sampled every minute; rates from minute ${String(WARM_MINUTES)} on (least squares).`,
    '',
  ];
  const json: Record<string, Record<string, { ws: Rate | null; priv: Rate | null }>> = {};
  for (const h of halves) {
    const rates: Record<string, { ws: Rate | null; priv: Rate | null }> = {};
    json[h.name] = rates;
    report.push(
      `### ${h.name}: ${String(h.samples.length)} samples`,
      '',
      '| Window | Working set: first → last MB | MB an hour | Quarters (median MB) | Private bytes: first → last MB | MB an hour |',
      '|---|---:|---:|---|---:|---:|',
    );
    for (const w of windows) {
      const series = (key: 'ws' | 'priv') =>
        h.samples.flatMap((s): [number, number][] => {
          const v = s.windows[w]?.[key];
          return v === undefined ? [] : [[(s.at - h.from) / 60_000, v]];
        });
      const ws = rateOf(series('ws'));
      const priv = rateOf(series('priv'));
      rates[w] = { ws, priv };
      if (!ws) continue;
      report.push(
        `| ${w} | ${mb(ws.first)} → ${mb(ws.last)} | ${mb(ws.perHour)} | ${ws.quarters.map((q) => (q === null ? '–' : mb(q))).join(', ')} | ${priv ? `${mb(priv.first)} → ${mb(priv.last)}` : '–'} | ${priv ? mb(priv.perHour) : '–'} |`,
      );
    }
    report.push('');
  }
  const text = report.join('\n');
  writeFileSync(join(OUT, 'devtools.md'), text);
  writeFileSync(join(OUT, 'summary.md'), text);
  writeFileSync(join(OUT, 'devtools.json'), JSON.stringify({ halves: json, lines }, null, 1));
  console.log(text);

  // Both halves ran the whole time, with both outputs.
  expect(stillRunning, 'Drashti started plainly ran the whole half').toBe(true);
  expect(outputsAttached).toBe(2);
  for (const h of halves)
    expect(h.samples.length, `${h.name}: memory samples`).toBeGreaterThanOrEqual(HALF_MINUTES - 3);
});
