import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editablePptxFixture, slideXml } from '../../src/main/import/testing/editable-pptx-fixture';
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
 * own and an element's within it (render/NativeDeckElement.tsx), each a straight ramp beside two sides and a repeating
 * conic gradient letting everything through beside the other two. Unit tests read the masks as CSS says to; this reads
 * what Chromium itself draws, on a hall screen, half-way: white shapes on black, so a pixel's red is how much shows.
 * Generated placeholder deck only.
 */

const dispatch = (win: Page, command: EngineCommand) =>
  win.evaluate((command) => (globalThis as PageGlobals).drashti.engine.dispatch(command), command);
const current = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide);

/** How long each Shape runs: held half-way, each edge's middle is half the way from the middle to the corners. */
const SHAPE_MS = 2000;
const EMU = 6350;

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
 * One slide: a black full-slide shape, then the four white shapes, all four coming in by Shape at its one click, with
 * the small one fading in.
 */
function shapeDeck(): Buffer {
  const rect = (id: number, color: string, f: { x: number; y: number; width: number; height: number }) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${String(id)}" name="Placeholder rectangle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${String(f.x * EMU)}" y="${String(f.y * EMU)}"/><a:ext cx="${String(f.width * EMU)}" cy="${String(f.height * EMU)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
  // As PowerPoint writes Shape: shown at its start, then its reveal filter over the effect's length.
  const effect = (k: number, s: (typeof SHAPES)[number]) => {
    const id = 10 + 10 * k;
    return `<p:par><p:cTn id="${String(id)}" presetID="${String(s.preset)}" presetClass="entr" presetSubtype="${s.way === 'in' ? '16' : '32'}" fill="hold" nodeType="${k === 0 ? 'clickEffect' : 'withEffect'}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr><p:cTn id="${String(id + 1)}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${String(s.id)}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set><p:animEffect transition="in" filter="${s.outline}(${s.way})"><p:cBhvr><p:cTn id="${String(id + 2)}" dur="${String(SHAPE_MS)}"/><p:tgtEl><p:spTgt spid="${String(s.id)}"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>`;
  };
  const fade = `<p:par><p:cTn id="90" presetID="10" presetClass="entr" fill="hold" nodeType="withEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="91" dur="${String(SHAPE_MS)}"/><p:tgtEl><p:spTgt spid="${String(FADING.id)}"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>`;
  const click = `<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${SHAPES.map((s, k) => effect(k, s)).join('')}${fade}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
  const timing = `<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" nodeType="mainSeq"><p:childTnLst>${click}</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
  const tree =
    rect(2, '000000', { x: 0, y: 0, width: 1920, height: 1080 }) +
    SHAPES.map((s) => rect(s.id, 'FFFFFF', s.frame)).join('') +
    rect(FADING.id, 'FFFFFF', FADING.frame);
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
  ],
  plus: [
    [0.5, 0.5, 0.5],
    [-0.5, 0.9, 0.5],
    [0.1, -0.85, 1],
    [-0.8, 0.8, 0],
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
    await writeFile(file, shapeDeck());
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
      for (const s of SHAPES) {
        const inner = target(s.id).locator(':scope > [data-deck-motion-mask]');
        await expect(target(s.id), s.outline).toHaveCSS('opacity', '1');
        await expect(target(s.id), s.outline).toHaveCSS('clip-path', 'none');
        if (s.outline === 'circle') {
          await expect(target(s.id), s.outline).toHaveCSS('mask-image', /^radial-gradient\(/u);
          await expect(inner, s.outline).toHaveCount(0);
        } else {
          await expect(target(s.id), s.outline).toHaveCSS('mask-image', /^repeating-conic-gradient\(/u);
          await expect(inner, s.outline).toHaveCount(1);
          await expect(inner, s.outline).toHaveCSS('mask-image', /^repeating-conic-gradient\(/u);
        }
      }
      // Every other moving shape's DOM as before: nothing between its motion's element and its own.
      await expect(target(FADING.id)).toHaveCSS('opacity', '0.5');
      await expect(target(FADING.id).locator(':scope > [data-deck-motion-mask]')).toHaveCount(0);
      await expect(target(FADING.id)).toHaveCSS('mask-image', 'none');
      // What Chromium draws: each point's red within 26 of 255 times how much shows there.
      const samples = SHAPES.flatMap((s) =>
        POINTS[s.outline].map(([u, v, shows]) => ({
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

      // At the end: whole, and nothing masked.
      await holdClock(app, stepAt + SHAPE_MS);
      for (const s of SHAPES) {
        await expect(target(s.id), s.outline).toHaveCSS('mask-image', 'none');
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
