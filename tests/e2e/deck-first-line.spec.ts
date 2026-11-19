import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  STILLS_RUN6_LINES,
  STILLS_RUN6_NOTO,
  type StillsDeck,
  type StillsSlide,
  writeStillsDeck,
} from '../../src/main/import/testing/powerpoint-comparison-stills';
import type { EngineCommand } from '../../src/shared/engine/commands';
import { openEditor, sourceWord } from './deck-edit-fixtures';
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

/*
 * X20 (h-run6, Session 59): a PowerPoint box's first line where PowerPoint puts it, on the hall screens and in the
 * slide editor, within a point. PowerPoint's own PDF of real-PowerPoint run 6 (19 Nov 2026) gives each box's first
 * baseline below its words' top (points; the boxes are 18, 28, 40 and 66 pt, two lines each); Drashti is measured on a
 * hall screen (its 1920-wide canvas: 2 px a point) from each box's top, which leaves the box's insets out as PowerPoint's
 * words' top does. Generated placeholder decks only (Drashti's bundled Noto fonts are embedded in the Noto deck).
 */

/** PowerPoint's first baselines (points below the words' top), each slide's four boxes in order. */
const POWERPOINT: Record<string, readonly number[]> = {
  'Arial · single': [18.0, 26.88, 38.88, 64.08],
  'Arial · lines 150%': [24.0, 37.92, 54.0, 89.04],
  'Arial · lines 80%': [12.96, 20.88, 29.04, 48.0],
  'Arial · exactly 1.5 x size': [19.92, 31.92, 44.88, 73.92],
  'Times New Roman · lines 200%': [31.92, 49.92, 72.0, 119.04],
  'Verdana · lines 90%': [16.08, 24.0, 35.04, 58.08],
  'Arial anchored middle · lines 150%': [151.92, 149.04, 144.96, 135.84],
  'Arial anchored bottom · lines 80%': [295.2, 283.92, 269.04, 238.08],
  'Noto Sans Gujarati · single': [14.88, 23.04, 32.88, 54.0],
  'Noto Sans Gujarati · lines 150%': [23.04, 36.0, 50.88, 84.0],
  'Noto Sans Devanagari · lines 80%': [12.0, 18.0, 25.92, 42.96],
  'Noto Sans · lines 120%': [18.96, 30.0, 42.96, 71.04],
};

const dispatch = (win: Page, command: EngineCommand) =>
  win.evaluate((command) => (globalThis as PageGlobals).drashti.engine.dispatch(command), command);

/** Each box of words on the hall screen, left to right: its first line's baseline below its top, in points. */
function firstBaselines(): number[] {
  const scene = document.querySelector('[data-testid="scene"]');
  if (!scene) return [];
  const sr = scene.getBoundingClientRect();
  const width = Number((scene.getAttribute('data-canvas') ?? '1920x1080').split('x')[0]);
  const points = width / sr.width / (width / 960);
  return [...scene.querySelectorAll('[data-element]')]
    .filter((e) => e.querySelector('[data-line]'))
    .map((element) => {
      const line = element.querySelector('[data-line]');
      const run = line?.querySelector('[data-run]') ?? line;
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      run?.insertBefore(probe, run.firstChild);
      const baseline = probe.getBoundingClientRect().top;
      probe.remove();
      const box = element.getBoundingClientRect();
      return { x: box.left, at: (baseline - box.top) * points };
    })
    .sort((a, b) => a.x - b.x)
    .map((b) => Math.round(b.at * 100) / 100);
}

const slideNamed = (deck: StillsDeck, name: string): StillsSlide => {
  const slide = deck.slides.find((s) => s.name === name);
  if (!slide) throw new Error(`No slide ${name}`);
  return slide;
};

test('a deck box’s first line sits where PowerPoint puts it on the hall screens, within a point', async () => {
  test.setTimeout(300_000);
  const dir = await mkdtemp(join(tmpdir(), 'drashti-first-line-'));
  try {
    const decks = [STILLS_RUN6_LINES, STILLS_RUN6_NOTO];
    const files: string[] = [];
    for (const [i, deck] of decks.entries()) {
      await mkdir(join(dir, String(i)));
      files.push(await writeStillsDeck(join(dir, String(i)), deck));
    }
    // No converter (CI has none): a still deck comes in drawn by Drashti itself.
    const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1' });
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      const ids = await importAndGetIds(win, files);
      expect(ids.every((id) => id !== '')).toBe(true);
      await setUpScreen(win, 'Main Hall', 0);
      const out = await outputPage(app);
      await outputReady(out);
      await out.evaluate(() => document.fonts.ready.then(() => undefined));
      const differs: string[] = [];
      for (const [name, powerpoint] of Object.entries(POWERPOINT)) {
        const d = decks.findIndex((deck) => deck.slides.some((s) => s.name === name));
        const deck = decks[d] ?? STILLS_RUN6_LINES;
        const slide = slideNamed(deck, name);
        await dispatch(win, {
          type: 'goLive',
          presentationId: ids[d] ?? '',
          slideIndex: deck.slides.indexOf(slide),
        });
        await expect(out.locator('[data-line]')).toHaveCount(8);
        await expect(out.locator('[data-line]').first()).toContainText(
          slide.boxes?.[0]?.paragraphs[0]?.text ?? '',
        );
        await out.evaluate(
          () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
        );
        const drashti = await out.evaluate(firstBaselines);
        expect(drashti, name).toHaveLength(4);
        drashti.forEach((at, i) => {
          const want = powerpoint[i] ?? Number.NaN;
          if (!(Math.abs(at - want) <= 1))
            differs.push(`${name} box ${String(i + 1)}: ${String(at)} pt, PowerPoint ${String(want)}`);
        });
      }
      expect(differs, `first baselines more than a point from PowerPoint’s (${process.platform})`).toEqual(
        [],
      );
    } finally {
      await app.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the slide editor draws a deck box’s first line where the screens do, and keeps it there while typing', async () => {
  test.setTimeout(240_000);
  const dir = await mkdtemp(join(tmpdir(), 'drashti-first-line-editor-'));
  try {
    const slide = slideNamed(STILLS_RUN6_LINES, 'Arial · lines 150%');
    const deck: StillsDeck = {
      file: 'Placeholder first line.pptx',
      dark: false,
      slides: [{ ...slide, marker: 20 }],
    };
    const file = await writeStillsDeck(dir, deck);
    const { app } = await launchApp();
    try {
      const win = await operatorPage(app);
      await operatorReady(win);
      const [id = ''] = await importAndGetIds(win, [file]);
      expect(id).not.toBe('');
      const { ed, editor } = await openEditor(app, win, 'Placeholder first line');
      const box = sourceWord(editor, 'Line A').nth(2);
      await expect(box).toBeVisible();
      /** The box's first baseline below its top, in points (its frame is 40 pt words in a box 2.8 in wide). */
      const measure = () =>
        box.evaluate((element) => {
          const first =
            element.querySelector('[data-line] [data-run]') ?? element.querySelector('p') ?? element;
          const probe = document.createElement('span');
          probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
          first.insertBefore(probe, first.firstChild);
          const baseline = probe.getBoundingClientRect().top;
          probe.remove();
          const rect = element.getBoundingClientRect();
          // The box's words are 2.8 in less the insets' 0.2 in wide: 187.2 pt.
          return ((baseline - rect.top) * 187.2) / rect.width;
        });
      const drawn = await measure();
      expect(
        Math.abs(drawn - 54.0),
        `the editor’s slide: ${String(drawn)} pt, PowerPoint 54`,
      ).toBeLessThanOrEqual(1);
      // Typing in it: the words stay where they were drawn.
      await box.dblclick();
      const typing = editor.getByTestId('text-editing');
      await expect(typing).toBeVisible();
      const editing = await typing.evaluate((element) => {
        const range = document.createRange();
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const text = walker.nextNode();
        if (!text) return Number.NaN;
        range.setStart(text, 0);
        range.setEnd(text, 1);
        const glyph = range.getBoundingClientRect();
        // From the box's own top, as the drawn box is measured below (the words inside it may be moved).
        const rect = (element.closest('[data-element]') ?? element).getBoundingClientRect();
        return ((glyph.top - rect.top) * 187.2) / rect.width;
      });
      await ed.keyboard.press('Escape');
      await expect(typing).toHaveCount(0);
      const still = await box.evaluate((element) => {
        const text = element.querySelector('[data-line] [data-run]')?.firstChild;
        if (!text) return Number.NaN;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 1);
        const glyph = range.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return ((glyph.top - rect.top) * 187.2) / rect.width;
      });
      expect(
        Math.abs(editing - still),
        `typing: the first letter’s top ${String(editing)} pt, drawn ${String(still)}`,
      ).toBeLessThanOrEqual(0.5);
    } finally {
      await app.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
