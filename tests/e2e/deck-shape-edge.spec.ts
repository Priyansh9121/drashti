import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editablePptxFixture, slideXml } from '../../src/main/import/testing/editable-pptx-fixture';
import { deckShapeShows } from '../../src/shared/deck-motion';
import type { EngineCommand } from '../../src/shared/engine/commands';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  type PageGlobals,
  setUpScreen,
} from './helpers';
import { canvasPixels } from './pixels';
import { holdClock } from './placeholder-slides';

/*
 * Shape's soft edge as the screens draw it (Session 58, C1): PowerPoint's own movie shows each outline's edge as a
 * straight soft band (shared/deck-motion.ts, deckShapeShows), a Box's and a Plus's corners square. Drashti draws a
 * Circle's with one radial mask, and a Box's, a Plus's and a Diamond's with two masks multiplied, the moving shape's
 * own and an element's within it (render/NativeDeckElement.tsx), each a straight ramp beside two sides and two
 * half-planes through the middle, laid on one another by `exclude`, letting everything through beside the other two.
 * (A conic gradient there drew a faint line along each seam where nothing shows, on CI's Mac: Chromium smooths its hard
 * stop.) Unit tests read the masks as CSS says to; this reads what Chromium itself draws, on a hall screen, half-way:
 * white shapes on black, so a pixel's red is how much shows, the hidden points on the seams too.
 * Generated placeholder deck only.
 */

/**
 * Whether an output draws without a graphics chip (its warm-up skipped, as on CI's Windows): a Shape then draws its
 * hard edge, a clip where PowerPoint's soft edge is half-way, in place of its masks (render/deck-target-paint.ts, C1's
 * review HIGH-2: two masks of three gradients each on every moving Box, Plus and Diamond dropped frames there while
 * streaming); with one (CI's Mac) the soft edge.
 */
const drawsWithoutChip = async (page: Page): Promise<boolean> =>
  (await page.getByTestId('output-root').getAttribute('data-warm-up')) === 'skipped';

const dispatch = (win: Page, command: EngineCommand) =>
  win.evaluate((command) => (globalThis as PageGlobals).drashti.engine.dispatch(command), command);
const current = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide);

/** How long each Shape runs: held half-way, each edge's middle is half the way from the middle to the corners. */
const SHAPE_MS = 2000;
const EMU = 6350;

interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A white shape on the slide coming in by Shape: its id, outline, In or Out, PowerPoint's preset and its frame. */
interface ShapeIn {
  id: number;
  outline: 'box' | 'plus' | 'diamond' | 'circle';
  way: 'in' | 'out';
  preset: number;
  frame: Frame;
}

/** The four shapes on a 1920 × 1080 slide, their outlines and ids, each a quarter of the slide less a margin. */
const SHAPES = [
  { id: 3, outline: 'box', way: 'out', preset: 4, frame: { x: 80, y: 60, width: 800, height: 440 } },
  { id: 4, outline: 'plus', way: 'out', preset: 13, frame: { x: 1040, y: 60, width: 800, height: 440 } },
  { id: 5, outline: 'diamond', way: 'out', preset: 8, frame: { x: 80, y: 580, width: 800, height: 440 } },
  { id: 6, outline: 'circle', way: 'in', preset: 6, frame: { x: 1040, y: 580, width: 800, height: 440 } },
] as const;

/** A fifth, small, between them, that fades in at the same click: its DOM stays as every other moving shape's. */
const FADING = { id: 7, frame: { x: 900, y: 510, width: 120, height: 60 } };

/**
 * Seams on pixel centres (C1's review, HIGH-1, 14 Nov 2026). A screen drawing the slide at exactly half its size
 * (960 × 540 pixels) draws a 432-px square at an even place as a 216-pixel square on whole pixels, its falling
 * diagonal through pixel centres, as a square on PowerPoint's 1/12-inch grid (12 px) is on a 1080p hall screen; and a
 * Diamond 402 px wide as 201 pixels, its middle column through pixel centres. Such a pixel lies on the step of both
 * masks' half-planes, and the two masks must put it on one side of the seam: two steps pointing opposite ways both gave
 * it their second colour, so everything showed there, a white line across what is hidden.
 */
const SEAMS: readonly ShapeIn[] = [
  { id: 3, outline: 'box', way: 'out', preset: 4, frame: { x: 216, y: 144, width: 432, height: 432 } },
  { id: 4, outline: 'plus', way: 'out', preset: 13, frame: { x: 1080, y: 144, width: 432, height: 432 } },
  { id: 5, outline: 'diamond', way: 'in', preset: 8, frame: { x: 216, y: 624, width: 402, height: 302 } },
];

/**
 * One slide: a black full-slide shape, then white shapes, all coming in by Shape at its one click, with a small one
 * fading in when given.
 */
function shapeDeck(shapes: readonly ShapeIn[], fading?: { id: number; frame: Frame }): Buffer {
  const rect = (id: number, color: string, f: Frame) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${String(id)}" name="Placeholder rectangle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${String(f.x * EMU)}" y="${String(f.y * EMU)}"/><a:ext cx="${String(f.width * EMU)}" cy="${String(f.height * EMU)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
  // As PowerPoint writes Shape: shown at its start, then its reveal filter over the effect's length.
  const effect = (k: number, s: ShapeIn) => {
    const id = 10 + 10 * k;
    return `<p:par><p:cTn id="${String(id)}" presetID="${String(s.preset)}" presetClass="entr" presetSubtype="${s.way === 'in' ? '16' : '32'}" fill="hold" nodeType="${k === 0 ? 'clickEffect' : 'withEffect'}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr><p:cTn id="${String(id + 1)}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${String(s.id)}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set><p:animEffect transition="in" filter="${s.outline}(${s.way})"><p:cBhvr><p:cTn id="${String(id + 2)}" dur="${String(SHAPE_MS)}"/><p:tgtEl><p:spTgt spid="${String(s.id)}"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>`;
  };
  const fade = fading
    ? `<p:par><p:cTn id="90" presetID="10" presetClass="entr" fill="hold" nodeType="withEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="91" dur="${String(SHAPE_MS)}"/><p:tgtEl><p:spTgt spid="${String(fading.id)}"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>`
    : '';
  const click = `<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${shapes.map((s, k) => effect(k, s)).join('')}${fade}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
  const timing = `<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" nodeType="mainSeq"><p:childTnLst>${click}</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
  const tree =
    rect(2, '000000', { x: 0, y: 0, width: 1920, height: 1080 }) +
    shapes.map((s) => rect(s.id, 'FFFFFF', s.frame)).join('') +
    (fading ? rect(fading.id, 'FFFFFF', fading.frame) : '');
  return editablePptxFixture({ slides: [slideXml(tree).replace('</p:sld>', `${timing}</p:sld>`)] });
}

/**
 * Points of each shape (u, v from -1 to 1 across it) and how much shows there half-way: on the edge's middle (half),
 * on the box's diagonal too (a square corner: half; two gradients multiplied would draw a quarter, a Plus's three
 * quarters), well inside what has come and well outside it.
 */
const POINTS: Record<(typeof SHAPES)[number]['outline'], readonly [u: number, v: number, shows: number][]> = {
  box: [
    [0.5, 0.5, 0.5],
    [-0.5, 0.1, 0.5],
    [0.25, -0.25, 1],
    [0.75, 0.2, 0],
    [0.8, -0.8, 0],
    [-0.9, 0.9, 0],
  ],
  plus: [
    [0.5, 0.5, 0.5],
    [-0.5, 0.9, 0.5],
    [0.1, -0.85, 1],
    [-0.8, 0.8, 0],
    [0.9, -0.9, 0],
  ],
  diamond: [
    [0.5, 0.5, 0.5],
    [-0.8, 0.2, 0.5],
    [0.2, -0.2, 1],
    [0.7, 0.65, 0],
  ],
  circle: [
    [0.5, 0.5, 0.5],
    [-Math.SQRT1_2, 0, 0.5],
    [0.9, -0.9, 1],
    [0, 0, 0],
  ],
};

test('Shape’s soft edge on a hall screen, half-way: a Box’s, a Plus’s and a Diamond’s square-cornered, a Circle’s round', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'drashti-shape-edge-'));
  try {
    const file = join(dir, 'Placeholder Shape edges.pptx');
    await writeFile(file, shapeDeck(SHAPES, FADING));
    // No PowerPoint (a stand-in converter, no deck's movie made): Drashti plays the click itself.
    const { app } = await launchApp({
      DRASHTI_WINDOWED_OUTPUTS: '1',
      DRASHTI_TEST_CLOCK_HOLD: '1',
      DRASHTI_TEST_DECK_CONVERTER: '1',
    });
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      const [id = ''] = await importAndGetIds(win, [file]);
      expect(id).not.toBe('');
      await setUpScreen(win, 'Main Hall', 0);
      const out = await outputPage(app);
      await outputReady(out);
      const target = (shape: number) => out.locator(`[data-deck-motion-target="${String(shape)}"]`);

      await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
      await expect.poll(async () => (await current(win))?.step).toBe(0);
      for (const s of SHAPES) await expect(target(s.id)).toHaveCSS('opacity', '0');
      await dispatch(win, { type: 'next' });
      await expect.poll(async () => (await current(win))?.step).toBe(1);
      const stepAt = (await current(win))?.stepAt ?? 0;
      await holdClock(app, stepAt + SHAPE_MS / 2);

      // The masks: a Circle's one radial gradient on the shape; the others' two, the shape's and the element's within.
      // Without a graphics chip, the hard edge: a clip, no mask.
      const chipless = await drawsWithoutChip(out);
      for (const s of SHAPES) {
        const inner = target(s.id).locator(':scope > [data-deck-motion-mask]');
        await expect(target(s.id), s.outline).toHaveCSS('opacity', '1');
        await expect(inner, s.outline).toHaveCount(s.outline === 'circle' ? 0 : 1);
        if (chipless) {
          await expect(target(s.id), s.outline).toHaveCSS('clip-path', /^polygon\(/u);
          await expect(target(s.id), s.outline).toHaveCSS('mask-image', 'none');
          if (s.outline !== 'circle') await expect(inner, s.outline).toHaveCSS('mask-image', 'none');
          continue;
        }
        await expect(target(s.id), s.outline).toHaveCSS('clip-path', 'none');
        if (s.outline === 'circle') {
          await expect(target(s.id), s.outline).toHaveCSS('mask-image', /^radial-gradient\(/u);
          await expect(inner, s.outline).toHaveCount(0);
        } else {
          await expect(inner, s.outline).toHaveCount(1);
          for (const masked of [target(s.id), inner]) {
            await expect(masked, s.outline).toHaveCSS(
              'mask-image',
              /^linear-gradient\(.*\), linear-gradient\(/u,
            );
            await expect(masked, s.outline).toHaveCSS('mask-composite', /^add, exclude/u);
          }
        }
      }
      // Every other moving shape's DOM as before: nothing between its motion's element and its own.
      await expect(target(FADING.id)).toHaveCSS('opacity', '0.5');
      await expect(target(FADING.id).locator(':scope > [data-deck-motion-mask]')).toHaveCount(0);
      await expect(target(FADING.id)).toHaveCSS('mask-image', 'none');
      // What Chromium draws: each point's red within 26 of 255 times how much shows there (a hard edge passes through
      // the half-way points: those left out without a chip).
      const samples = SHAPES.flatMap((s) =>
        POINTS[s.outline]
          .filter(([, , shows]) => !chipless || shows !== 0.5)
          .map(([u, v, shows]) => ({
            name: `${s.outline} at (${String(u)}, ${String(v)})`,
            shows,
            at: {
              x: s.frame.x + ((1 + u) * s.frame.width) / 2,
              y: s.frame.y + ((1 + v) * s.frame.height) / 2,
            },
          })),
      );
      await expect
        .poll(async () => {
          const got = await canvasPixels(
            out,
            samples.map((p) => p.at),
          );
          return samples.flatMap((p, i) => {
            const red = got[i]?.[0] ?? -1;
            return Math.abs(red - 255 * p.shows) <= 26
              ? []
              : [`${p.name}: ${String(red)}, not ${String(255 * p.shows)}`];
          });
        })
        .toEqual([]);

      // At the end: whole, and nothing masked or clipped.
      await holdClock(app, stepAt + SHAPE_MS);
      for (const s of SHAPES) {
        await expect(target(s.id), s.outline).toHaveCSS('mask-image', 'none');
        await expect(target(s.id), s.outline).toHaveCSS('clip-path', 'none');
        const inner = target(s.id).locator(':scope > [data-deck-motion-mask]');
        if (s.outline !== 'circle') await expect(inner, s.outline).toHaveCSS('mask-image', 'none');
      }
      await holdClock(app, null);
    } finally {
      await app.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** The colour of each pixel (whole x and y, the screen's own pixels) in a page's screenshot at its own pixel size. */
async function screenPixels(page: Page, points: readonly { x: number; y: number }[]): Promise<number[][]> {
  const png = (await page.screenshot({ scale: 'device' })).toString('base64');
  return page.evaluate(
    async ({ png, points }) => {
      // Decoded by hand: the page's security policy refuses fetch() of a data URL.
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return [];
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      return points.map(({ x, y }) => [
        ...data.subarray((y * bitmap.width + x) * 4, (y * bitmap.width + x) * 4 + 4),
      ]);
    },
    { png, points },
  );
}

test('Shape’s seams through pixel centres: nothing shows across what is hidden (a square Box’s and Plus’s falling diagonal, a Diamond’s middle column)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'drashti-shape-seams-'));
  try {
    const file = join(dir, 'Placeholder Shape seams.pptx');
    await writeFile(file, shapeDeck(SEAMS));
    const { app } = await launchApp({
      DRASHTI_WINDOWED_OUTPUTS: '1',
      DRASHTI_TEST_CLOCK_HOLD: '1',
      DRASHTI_TEST_DECK_CONVERTER: '1',
    });
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      const [id = ''] = await importAndGetIds(win, [file]);
      expect(id).not.toBe('');
      await setUpScreen(win, 'Main Hall', 0);
      const out = await outputPage(app);
      await outputReady(out);
      // The hall screen 960 × 540 of its own pixels: the slide at exactly half its size, on whole pixels.
      const ratio = await out.evaluate(() => devicePixelRatio);
      await app.evaluate(
        ({ BrowserWindow }, css) => {
          for (const w of BrowserWindow.getAllWindows()) {
            const url = w.webContents.getURL();
            if (url.includes('output.html') && !url.includes('identify='))
              w.setContentSize(css.width, css.height);
          }
        },
        { width: 960 / ratio, height: 540 / ratio },
      );
      await expect
        .poll(() =>
          out
            .getByTestId('scene')
            .first()
            .evaluate((scene) => {
              const r = scene.getBoundingClientRect();
              return [r.left, r.top, r.width, r.height].map(
                (n) => Math.round(n * devicePixelRatio * 1000) / 1000,
              );
            }),
        )
        .toEqual([0, 0, 960, 540]);
      const target = (shape: number) => out.locator(`[data-deck-motion-target="${String(shape)}"]`);

      await dispatch(win, { type: 'goLive', presentationId: id, slideIndex: 0 });
      await expect.poll(async () => (await current(win))?.step).toBe(0);
      await dispatch(win, { type: 'next' });
      await expect.poll(async () => (await current(win))?.step).toBe(1);
      const stepAt = (await current(win))?.stepAt ?? 0;
      await holdClock(app, stepAt + SHAPE_MS / 2);
      // Without a graphics chip, the hard edge (a clip, no mask): its seams too, read the same way.
      const chipless = await drawsWithoutChip(out);
      for (const s of SEAMS) {
        const inner = target(s.id).locator(':scope > [data-deck-motion-mask]');
        if (chipless) {
          await expect(target(s.id), s.outline).toHaveCSS('clip-path', /^polygon\(/u);
          for (const masked of [target(s.id), inner])
            await expect(masked, s.outline).toHaveCSS('mask-image', 'none');
        } else
          for (const masked of [target(s.id), inner])
            await expect(masked, s.outline).toHaveCSS('mask-composite', /^add, exclude/u);
      }

      // Every pixel along each seam (its centre on it), half-way: its red within 26 of 255 times how much shows there.
      // A square's falling diagonal (and, drawn by one step both masks share, its rising one); a Diamond's middle
      // column (and its middle row, shared).
      const seams = SEAMS.flatMap((s) => {
        const wipe = { shape: s.outline, inward: s.way === 'in', leaving: false, progress: 0.5 };
        // The shape's box on the screen, in its own pixels (half the slide's).
        const left = s.frame.x / 2;
        const top = s.frame.y / 2;
        const width = s.frame.width / 2;
        const height = s.frame.height / 2;
        const across = (i: number, n = width) => ((i + 0.5) / n) * 2 - 1;
        const lines: { name: string; at: { x: number; y: number }; u: number; v: number }[][] =
          s.outline === 'diamond'
            ? [
                Array.from({ length: height }, (_, j) => ({
                  name: `${s.outline}'s middle column`,
                  at: { x: left + (width - 1) / 2, y: top + j },
                  u: 0,
                  v: across(j, height),
                })),
                Array.from({ length: width }, (_, i) => ({
                  name: `${s.outline}'s middle row`,
                  at: { x: left + i, y: top + (height - 1) / 2 },
                  u: across(i),
                  v: 0,
                })),
              ]
            : [
                Array.from({ length: width }, (_, i) => ({
                  name: `${s.outline}'s falling diagonal`,
                  at: { x: left + i, y: top + i },
                  u: across(i),
                  v: across(i),
                })),
                Array.from({ length: width }, (_, i) => ({
                  name: `${s.outline}'s rising diagonal`,
                  at: { x: left + i, y: top + height - 1 - i },
                  u: across(i),
                  v: -across(i),
                })),
              ];
        return lines.flat().map((p) => ({ ...p, shows: deckShapeShows(wipe, p.u, p.v) }));
      });
      // Each seam pixel's place on the screen is whole: the premise of this test.
      expect(seams.filter((p) => !Number.isInteger(p.at.x) || !Number.isInteger(p.at.y))).toEqual([]);
      // Without a chip the hard edge, where more than half would show whole and the rest nothing (the pixels within
      // 0.3 of half-way, the edge's own, left out).
      const read = chipless
        ? seams
            .filter((p) => Math.abs(p.shows - 0.5) >= 0.3)
            .map((p) => ({ ...p, shows: p.shows > 0.5 ? 1 : 0 }))
        : seams;
      await expect
        .poll(async () => {
          const got = await screenPixels(
            out,
            read.map((p) => p.at),
          );
          const off = new Map<string, string[]>();
          read.forEach((p, i) => {
            const red = got[i]?.[0] ?? -1;
            if (Math.abs(red - 255 * p.shows) <= 26) return;
            const list = off.get(p.name) ?? [];
            list.push(
              `(${String(p.at.x)}, ${String(p.at.y)}) ${String(red)} not ${String(Math.round(255 * p.shows))}`,
            );
            off.set(p.name, list);
          });
          return [...off].map(
            ([name, list]) => `${name}: ${String(list.length)} off, ${list.slice(0, 3).join('; ')}`,
          );
        })
        .toEqual([]);
      await holdClock(app, null);
    } finally {
      await app.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
