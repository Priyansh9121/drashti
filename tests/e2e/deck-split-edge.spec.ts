import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editablePptxFixture, slideXml } from '../../src/main/import/testing/editable-pptx-fixture';
import { deckSplitShows } from '../../src/shared/deck-motion';
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
import { holdClock } from './placeholder-slides';

/*
 * A Split's soft edges on a box whose edge falls between pixels (Q58-55, Session 58): drawn in software (a PC without a
 * graphics chip: CI's Windows), any CSS mask on such a box drew that edge's row at three quarters of what it should be
 * (C22's diagnostic: a box 150.996 pixels high, its last row 192 for 255); the masked shape a layer of its own while
 * masked draws it exactly (render/deck-target-paint.ts). Read here as Chromium draws it on a hall screen at exactly
 * half the slide's size: white boxes on black, so a pixel's red is how much shows, every pixel of each box's outer rows
 * and columns. Generated placeholder deck only.
 */

const SPLIT_MS = 2000;
const EMU = 6350;

interface SplitBox {
  id: number;
  filter: 'barn(outVertical)' | 'barn(outHorizontal)';
  axis: 'x' | 'y';
  frame: { x: number; y: number; width: number; height: number };
}

/** Two boxes 302 px high on the slide, drawn 150.996 pixels high at half its size (as the importer reads 302 px). */
const BOXES: readonly SplitBox[] = [
  { id: 3, filter: 'barn(outVertical)', axis: 'x', frame: { x: 216, y: 624, width: 402, height: 302 } },
  { id: 4, filter: 'barn(outHorizontal)', axis: 'y', frame: { x: 1080, y: 624, width: 402, height: 302 } },
];

function splitDeck(): Buffer {
  const rect = (id: number, color: string, f: SplitBox['frame']) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${String(id)}" name="Placeholder rectangle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${String(f.x * EMU)}" y="${String(f.y * EMU)}"/><a:ext cx="${String(f.width * EMU)}" cy="${String(f.height * EMU)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
  // As PowerPoint writes Split: shown at its start, then its reveal filter over the effect's length.
  const effect = (k: number, b: SplitBox) => {
    const id = 10 + 10 * k;
    return `<p:par><p:cTn id="${String(id)}" presetID="16" presetClass="entr" presetSubtype="${b.axis === 'x' ? '42' : '26'}" fill="hold" nodeType="${k === 0 ? 'clickEffect' : 'withEffect'}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr><p:cTn id="${String(id + 1)}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${String(b.id)}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set><p:animEffect transition="in" filter="${b.filter}"><p:cBhvr><p:cTn id="${String(id + 2)}" dur="${String(SPLIT_MS)}"/><p:tgtEl><p:spTgt spid="${String(b.id)}"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>`;
  };
  const click = `<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${BOXES.map((b, k) => effect(k, b)).join('')}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
  const timing = `<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" nodeType="mainSeq"><p:childTnLst>${click}</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
  const tree =
    rect(2, '000000', { x: 0, y: 0, width: 1920, height: 1080 }) +
    BOXES.map((b) => rect(b.id, 'FFFFFF', b.frame)).join('');
  return editablePptxFixture({ slides: [slideXml(tree).replace('</p:sld>', `${timing}</p:sld>`)] });
}

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

test('a Split’s soft edges on a box whose edge falls between pixels: every pixel of its outer rows and columns as it shows, without a graphics chip too (Q58-55)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'drashti-split-edge-'));
  try {
    const file = join(dir, 'Placeholder Split edges.pptx');
    await writeFile(file, splitDeck());
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
      // The hall screen 960 × 540 of its own pixels: the slide at exactly half its size.
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
      const dispatch = (command: EngineCommand) =>
        win.evaluate((command) => (globalThis as PageGlobals).drashti.engine.dispatch(command), command);
      const current = () =>
        win.evaluate(
          async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.slide,
        );

      await dispatch({ type: 'goLive', presentationId: id, slideIndex: 0 });
      await expect.poll(async () => (await current())?.step).toBe(0);
      await dispatch({ type: 'next' });
      await expect.poll(async () => (await current())?.step).toBe(1);
      const stepAt = (await current())?.stepAt ?? 0;
      await holdClock(app, stepAt + SPLIT_MS / 2);
      // Half-way: each box masked, its edge between pixels (the premise: its height on the screen not whole).
      for (const b of BOXES) {
        await expect(target(b.id), b.filter).toHaveCSS('mask-image', /^linear-gradient\(/u);
        const height = await target(b.id).evaluate(
          (t) => t.getBoundingClientRect().height * devicePixelRatio,
        );
        expect(
          Number.isInteger(Math.round(height * 1000) / 1000),
          `${b.filter}: ${String(height)} px high`,
        ).toBe(false);
      }

      // Every pixel of each box's first, second, second-last and last rows and first and last columns: its red within
      // 26 of 255 times how much shows there (deckSplitShows across the box's axis).
      const read = BOXES.flatMap((b) => {
        const wipe = { axis: b.axis, inward: false, leaving: false, progress: 0.5 };
        const left = b.frame.x / 2;
        const top = b.frame.y / 2;
        const width = Math.round(b.frame.width / 2);
        const height = Math.round(b.frame.height / 2);
        const across = (i: number, n: number) => ((i + 0.5) / n) * 2 - 1;
        const at = (i: number, j: number) => ({
          name: '',
          at: { x: left + i, y: top + j },
          shows: deckSplitShows(wipe, b.axis === 'x' ? across(i, width) : across(j, height)),
        });
        const rows = [0, 1, height - 2, height - 1].flatMap((j) =>
          Array.from({ length: width }, (_, i) => ({ ...at(i, j), name: `${b.filter} row ${String(j)}` })),
        );
        const columns = [0, width - 1].flatMap((i) =>
          Array.from({ length: height }, (_, j) => ({
            ...at(i, j),
            name: `${b.filter} column ${String(i)}`,
          })),
        );
        return [...rows, ...columns];
      });
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

      // At the end: whole, nothing masked.
      await holdClock(app, stepAt + SPLIT_MS);
      for (const b of BOXES) {
        await expect(target(b.id), b.filter).toHaveCSS('mask-image', 'none');
        await expect(target(b.id), b.filter).toHaveCSS('will-change', 'auto');
      }
      await holdClock(app, null);
    } finally {
      await app.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
