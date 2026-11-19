import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  importAndGetIds,
  launchApp,
  letTimePass,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  type PageGlobals,
  setUpScreen,
} from './helpers';

/*
 * A deck's first native Cover makes no new shaded GPU pipeline after warm-up. Each generated slide has the same
 * picture, native metadata and title/line geometry as the paired Performance check. The first trace proves that a
 * graphics chip made pipelines at the start; subsequent traces contain the first wide and 4:3 Covers. A computer
 * without a graphics chip makes none either way. Frame-time acceptance is the separate paired measuring's job.
 */
interface TraceEvent {
  name?: string;
  ph?: string;
  ts?: number;
  dur?: number;
  args?: { desc?: string };
}
const startTrace = (app: ElectronApplication) =>
  app.evaluate(async ({ contentTracing }) => {
    await contentTracing.startRecording({
      included_categories: ['skia.shaders', 'disabled-by-default-skia.shaders', 'gpu.dawn'],
      excluded_categories: ['*'],
    });
  });
const stopTrace = (app: ElectronApplication, file: string) =>
  app.evaluate(async ({ contentTracing }, file) => contentTracing.stopRecording(file), file);
function pipelines(file: string): string[] {
  if (!existsSync(file)) throw new Error('the GPU trace was not saved');
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { traceEvents?: TraceEvent[] } | TraceEvent[];
  const events = Array.isArray(parsed) ? parsed : (parsed.traceEvents ?? []);
  return events
    .filter((e) => e.ph === 'X' && e.name === 'createGraphicsPipeline')
    .map((e) => e.args?.desc ?? '');
}

// The same full-slide JPEG, native metadata and title/line geometry as main/perf-animations.ts deckOwnSlides.
async function placeholderDeck(win: Page, width: number, picture: string): Promise<string> {
  return win.evaluate(
    async ({ width, picture }) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.library.newFromWords(
        `Placeholder native ${String(width)}`,
        'Placeholder first\n\nPlaceholder wipe\n\nPlaceholder cover',
      );
      if (!made.ok) throw new Error(made.message);
      const opened = await d.library.slidesForEdit(made.id);
      if (!opened.ok) throw new Error(opened.message);
      const { doc } = opened;
      doc.width = width;
      doc.height = 1080;
      doc.transition = { kind: 'cut', durationMs: 0 };
      const all = doc.groups.flatMap((g) => g.slides);
      all.forEach((s, i) => {
        const effect = i === 1 ? 'wipe' : 'cover';
        s.background = null;
        s.transition = { kind: 'cut', durationMs: 0 };
        s.deck = {
          steps: [],
          media: [],
          motion: { effects: [], stepsMs: [0], approximate: false },
          ...(i > 0
            ? {
                transition: {
                  name: effect,
                  durationMs: 700,
                  nativeTransition: {
                    kind: effect === 'wipe' ? 'wipe' : 'slide',
                    deckEffect: effect,
                    direction: 'left',
                    durationMs: 700,
                  },
                },
              }
            : {}),
        };
        s.elements = [
          {
            id: `picture-${String(i)}`,
            kind: 'image',
            frame: { x: 0, y: 0, width, height: 1080 },
            mediaId: picture,
            fit: 'fill',
            sourceShapeId: '2',
          },
          ...[
            {
              id: 'title',
              shape: '3',
              y: 120,
              height: 200,
              size: 80,
              text: `Placeholder deck title ${String(i + 1)}`,
            },
            {
              id: 'line',
              shape: '4',
              y: 360,
              height: 140,
              size: 56,
              text: 'A placeholder line on the slide',
            },
          ].map((t) => ({
            id: `${t.id}-${String(i)}`,
            kind: 'text' as const,
            frame: { x: 160, y: t.y, width: width - 320, height: t.height },
            text: t.text,
            lang: 'en' as const,
            sourceShapeId: t.shape,
            style: {
              fontFamily: null,
              fontSize: t.size,
              fontWeight: 500,
              color: '#ffffff',
              align: 'center' as const,
              verticalAlign: 'middle' as const,
              lineHeight: 1.25,
              shadow: true,
              shrinkToFit: true,
            },
          })),
        ];
      });
      const saved = await d.library.saveSlides(made.id, doc, opened.stamp);
      if (!saved.ok) throw new Error(saved.message);
      return made.id;
    },
    { width, picture },
  );
}

test('the first wide and 4:3 native Covers make no new shaded GPU pipelines after warm-up', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp();
  const folder = mkdtempSync(join(tmpdir(), 'drashti-cover-pipelines-'));
  const warmTrace = join(test.info().outputDir, 'warm-up-pipelines.json');
  let recording = false;
  try {
    await startTrace(app);
    recording = true;
    const win = await operatorPage(app);
    await operatorReady(win);
    await expect.poll(() => win.locator('[data-testid="live-preview"] [data-warm-up]').count()).toBe(0);
    await expect(win.getByTestId('opening')).toHaveCount(0, { timeout: 30_000 });
    const base64 = await win.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no generated picture context');
      context.fillStyle = '#503070';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#704090';
      context.fillRect(0, 0, canvas.width / 2, canvas.height / 2);
      return canvas.toDataURL('image/jpeg').split(',')[1] ?? '';
    });
    const pictureFile = join(folder, 'Placeholder native.jpg');
    writeFileSync(pictureFile, Buffer.from(base64, 'base64'));
    const [picture = ''] = await importAndGetIds(win, [pictureFile]);
    expect(picture).not.toBe('');
    const decks: { width: number; id: string }[] = [];
    for (const width of [1920, 1440]) decks.push({ width, id: await placeholderDeck(win, width, picture) });
    await setUpScreen(win);
    const hall = await outputPage(app);
    await outputReady(hall);
    await stopTrace(app, warmTrace);
    recording = false;
    const madeAtStart = pipelines(warmTrace);
    if (process.platform === 'darwin')
      expect(madeAtStart.length, 'pipelines made at the start').toBeGreaterThan(0);
    for (const { width, id } of decks) {
      await win.evaluate(
        (id) =>
          (globalThis as PageGlobals).drashti.engine.dispatch({
            type: 'goLive',
            presentationId: id,
            slideIndex: 0,
          }),
        id,
      );
      await expect(hall.locator('[data-layer="slide"] [data-slide]')).toHaveCount(1);
      await letTimePass(win, 1000, 'the native first slide and its generated picture draw before Next');
      await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'next' }));
      await letTimePass(win, 1400, 'the deck Wipe completes before its first Cover');
      const file = join(test.info().outputDir, `cover-${String(width)}-pipelines.json`);
      await startTrace(app);
      recording = true;
      const transition = await win.evaluate(async () => {
        const d = (globalThis as PageGlobals).drashti;
        await d.engine.dispatch({ type: 'next' });
        return (await d.engine.snapshot()).state.layers.slide?.transition;
      });
      expect(transition).toMatchObject({ deckEffect: 'cover', durationMs: 700 });
      await letTimePass(win, 1400, 'the complete first Cover and its settling frames are traced');
      await stopTrace(app, file);
      recording = false;
      const made = pipelines(file);
      const shaded = made.filter((desc) => desc.includes('MatrixColorFilter'));
      expect(
        shaded,
        `${String(width)} native Cover made shaded pipelines after warm-up (${String(made.length)} new in all)`,
      ).toEqual([]);
    }
  } finally {
    if (recording)
      await stopTrace(app, join(test.info().outputDir, 'interrupted-pipelines.json')).catch(() => undefined);
    await app.close();
  }
});
