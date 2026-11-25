import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  importAndGetIds,
  launchApp,
  letTimePass,
  operatorPage,
  operatorReady,
  outputPage,
  setUpScreen,
} from './helpers';
import { logLines } from './log-lines';
import { drawPicture, goLive, makeSlides } from './placeholder-slides';

/*
 * The Stream panel's first drawing in the operator window, opened mid-show (Session 60, X21's second part: the lead's
 * ask after the owner's question Q60-4). Traced on CI's Mac (x21-1119-152307-74195 and -74205): opening it made, at
 * every start, kinds of drawing the operator window had not drawn yet (the primary button's gradient under its rounded
 * corners beside an icon, see-through fills plain and under rounded corners, a shadow), and on a new CI Mac the first
 * use of the gradient held the GPU, and every screen with it, 357-461 ms. The operator window's warm-up draws them
 * unseen at the start, so the panel opened later makes no new kind in any page's tile drawing. Read from Chromium's
 * trace: the GPU's new drawing pipelines (createGraphicsPipeline) made inside a page's tile drawing
 * (RendererRasterWorker), from the click until the stream's preview shows a picture and a second more. A computer
 * without a graphics chip makes none either way (CI's Windows draws in software): the rule's main way is CI's Mac,
 * where the start's own trace must show pipelines being made.
 */

interface TraceEvent {
  name?: string;
  ph?: string;
  pid?: number;
  tid?: number;
  ts?: number;
  dur?: number;
  args?: { desc?: string; name?: string };
}

const startTrace = (app: ElectronApplication, categories: string[]) =>
  app.evaluate(async ({ contentTracing }, categories) => {
    await contentTracing.startRecording({
      included_categories: categories,
      excluded_categories: ['*'],
      recording_mode: 'record-until-full',
      trace_buffer_size_in_kb: 200 * 1024,
    });
  }, categories);

const stopTrace = (app: ElectronApplication, file: string) =>
  app.evaluate(async ({ contentTracing }, f) => {
    await contentTracing.stopRecording(f);
  }, file);

function traceEvents(file: string): TraceEvent[] {
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { traceEvents?: TraceEvent[] } | TraceEvent[];
  return Array.isArray(parsed) ? parsed : (parsed.traceEvents ?? []);
}

/**
 * The new pipelines a trace saw: each one's description, whether a page's tile drawing made it, and whether the
 * compositor (Viz, in the GPU process) made it.
 */
function newPipelines(events: TraceEvent[]): { desc: string; tiles: boolean; compositor: boolean }[] {
  const tileWork = events.filter(
    (e) => e.ph === 'X' && e.name === 'RendererRasterWorker' && e.ts !== undefined && e.dur !== undefined,
  );
  const compositorThreads = new Set(
    events
      .filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'VizCompositorThread')
      .map((e) => `${String(e.pid)}:${String(e.tid)}`),
  );
  return events
    .filter((e) => e.ph === 'X' && e.name === 'createGraphicsPipeline' && e.ts !== undefined)
    .map((e) => ({
      desc: e.args?.desc ?? '',
      tiles: tileWork.some(
        (w) =>
          w.pid === e.pid &&
          w.tid === e.tid &&
          (w.ts ?? 0) <= (e.ts ?? 0) &&
          (e.ts ?? 0) <= (w.ts ?? 0) + (w.dur ?? 0),
      ),
      compositor: compositorThreads.has(`${String(e.pid)}:${String(e.tid)}`),
    }));
}

/**
 * How each hall screen's warm-up ended (Session 58, WU-2), or that it had none on a computer without a graphics chip
 * (Session 57, Q57-17: "Warm-up: skipped, no graphics chip …, for output …"), as Drashti's log says it once a screen.
 */
function hallWarmUps(userData: string): string[] {
  if (!existsSync(join(userData, 'logs'))) return [];
  return logLines(userData).filter((line) =>
    / Warm-up(?: of output |: skipped, no graphics chip .*, for output )/u.test(line),
  );
}
/** A hall screen's warm-up skipped or cut short: this computer draws without a graphics chip (CI's Windows). */
const chiplessLine = (line: string) =>
  line.includes(': skipped, no graphics chip ') || line.includes(', told it draws without a graphics chip');

const liveWarmedUp = (win: Page) =>
  win.evaluate(() => document.querySelector('[data-testid="live-preview"] [data-warm-up]') === null);

test('opening the Stream panel mid-show makes no new kind of drawing in any page’s tiles: the operator window’s warm-up made them', async () => {
  test.setTimeout(180_000);
  const { app, userData } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
  const out = test.info().outputDir;
  const startFile = join(out, 'start-trace.json');
  const openFile = join(out, 'open-trace.json');
  try {
    // From the start: what the warm-ups make (on a computer with a graphics chip there are always some).
    await startTrace(app, ['disabled-by-default-skia.shaders']);
    const win = await operatorPage(app);
    await operatorReady(win);
    await expect.poll(() => liveWarmedUp(win), { timeout: 60_000 }).toBe(true);
    // Mid-show: a slide up on a hall screen.
    const dir = mkdtempSync(join(tmpdir(), 'drashti-panel-warm-'));
    const file = await drawPicture(
      win,
      join(dir, 'Placeholder panel warm.png'),
      [
        { x: 0, y: 0, width: 0.5, height: 1, rgb: '40,60,110' },
        { x: 0.5, y: 0, width: 0.5, height: 1, rgb: '120,70,40' },
      ],
      { width: 1920, height: 1080 },
    );
    const [picture = ''] = await importAndGetIds(win, [file]);
    const id = await makeSlides(win, 'Placeholder panel warm', [{ picture, words: 'Placeholder words' }], {
      kind: 'zoom',
      durationMs: 1000,
    });
    await setUpScreen(win);
    const hall = await outputPage(app);
    await expect(hall.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 60_000 });
    // The stream's page then draws with no warm-up of its own (X21's first part), what it draws with made by the hall
    // screen's: at a new CI Mac's first start that warm-up can end at its longest, and its page loaded again draws
    // everything (stream-warm.spec.ts).
    const ends = () => hallWarmUps(userData);
    await expect.poll(() => ends().length, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
    const chipless = ends().some(chiplessLine);
    if (!chipless && !ends().some((line) => line.includes(': drew everything in '))) {
      await hall.reload();
      await expect.poll(() => ends().length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
      await expect(hall.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', {
        timeout: 60_000,
      });
    }
    await goLive(win, id, 0);
    await expect(hall.locator('[data-layer="slide"] [data-slide]')).toHaveCount(1, { timeout: 20_000 });
    await letTimePass(win, 2000, 'the slide’s fade over, the show running');
    await stopTrace(app, startFile);
    const atStart = newPipelines(traceEvents(startFile));
    if (process.platform === 'darwin')
      expect(atStart.length, 'pipelines made at the start').toBeGreaterThan(0);

    // The operator opens the Stream panel: everything the GPU makes from the click until the preview shows a picture.
    await startTrace(app, ['disabled-by-default-skia.shaders', 'gpu']);
    await letTimePass(win, 500, 'the trace running before the click');
    await win.getByTestId('open-stream').click();
    await expect(win.getByTestId('stream-panel')).toBeVisible({ timeout: 20_000 });
    await expect(win.getByTestId('stream-preview')).toHaveCount(1, { timeout: 60_000 });
    await letTimePass(win, 1000, 'the panel and its preview drawn');
    await stopTrace(app, openFile);
    const opened = newPipelines(traceEvents(openFile));
    const inTiles = opened.filter((p) => p.tiles).map((p) => p.desc);
    const why = `made in a page's tiles as the panel opened (${String(opened.length)} new in all)`;
    expect(inTiles, why).toEqual([]);
    // Nor by the compositor for a picture under rounded corners: the panel's preview in its Program box (the red's
    // trace, x21-1119-155149-81097: made new as the panel opened on both tries; the stream's page's own copies of its
    // picture are made beside it, in the GPU process's main thread, and are not the panel's).
    const rounded = opened.filter((p) => p.compositor && p.desc.includes('AnalyticClip')).map((p) => p.desc);
    expect(rounded, 'made by the compositor under rounded corners as the panel opened').toEqual([]);
  } finally {
    await app.close();
  }
});
