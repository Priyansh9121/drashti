import type { ElectronApplication, Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import type { Transition } from '../../src/shared/model';
import type { PageGlobals } from './helpers';

/*
 * Placeholder slides for the audience screens' motion checks (Session 27): a presentation made through
 * the bridge, each slide with its own picture (the whole canvas), white or coloured shapes and words, and
 * the transition asked for. Generated pictures and placeholder words only.
 */

export interface PlaceholderSlide {
  /** A picture's media id, drawn over the whole canvas. */
  picture?: string;
  /** Rectangles, in canvas pixels, under the words. */
  shapes?: { x: number; y: number; width: number; height: number; fill: string }[];
  /** Placeholder words, in a box across the middle (left out: none). */
  words?: string;
  /** The slide's own colour behind everything. */
  background?: string | null;
}

/** A rectangle of a picture, in fractions of its size, and its colour ("r,g,b"). */
export interface Patch {
  x: number;
  y: number;
  width: number;
  height: number;
  rgb: string;
}

/** A picture of coloured rectangles, drawn in the page; the PNG lands in `file`. */
export async function drawPicture(
  page: Page,
  file: string,
  patches: Patch[],
  size = { width: 640, height: 360 },
): Promise<string> {
  const base64 = await page.evaluate(
    ({ patches, size }) => {
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      for (const p of patches) {
        ctx.fillStyle = `rgb(${p.rgb})`;
        ctx.fillRect(p.x * size.width, p.y * size.height, p.width * size.width, p.height * size.height);
      }
      return canvas.toDataURL('image/png').split(',')[1] ?? '';
    },
    { patches, size },
  );
  writeFileSync(file, Buffer.from(base64, 'base64'));
  return file;
}

/** Two colours side by side. */
export const halves = (left: string, right: string): Patch[] => [
  { x: 0, y: 0, width: 0.5, height: 1, rgb: left },
  { x: 0.5, y: 0, width: 0.5, height: 1, rgb: right },
];

/** One colour all over. */
export const plain = (rgb: string): Patch[] => [{ x: 0, y: 0, width: 1, height: 1, rgb }];

/** A presentation of these slides, with `transition` for every slide; its id. */
export async function makeSlides(
  win: Page,
  name: string,
  slides: PlaceholderSlide[],
  transition: Transition,
): Promise<string> {
  return win.evaluate(
    async ({ name, slides, transition }) => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.library.newFromWords(
        name,
        slides.map((_, i) => `Placeholder ${String(i + 1)}`).join('\n\n'),
      );
      if (!made.ok) throw new Error(made.message);
      const opened = await d.library.slidesForEdit(made.id);
      if (!opened.ok) throw new Error(opened.message);
      const { doc } = opened;
      const all = doc.groups.flatMap((g) => g.slides);
      if (all.length !== slides.length)
        throw new Error(`${String(all.length)} slides made, not ${String(slides.length)}`);
      const full = { x: 0, y: 0, width: doc.width, height: doc.height };
      all.forEach((slide, i) => {
        const want = slides[i] ?? {};
        const text = slide.elements.find((e) => e.kind === 'text');
        slide.background = want.background ?? null;
        slide.elements = [
          ...(want.picture
            ? [
                {
                  id: `placeholder-picture-${String(i)}`,
                  kind: 'image' as const,
                  mediaId: want.picture,
                  frame: full,
                  fit: 'fill' as const,
                },
              ]
            : []),
          ...(want.shapes ?? []).map((s, j) => ({
            id: `placeholder-shape-${String(i)}-${String(j)}`,
            kind: 'shape' as const,
            shape: 'rectangle' as const,
            frame: { x: s.x, y: s.y, width: s.width, height: s.height },
            fill: s.fill,
            cornerRadius: 0,
            opacity: 1,
          })),
          ...(want.words !== undefined && text?.kind === 'text'
            ? [
                {
                  ...text,
                  text: want.words,
                  runs: text.runs?.slice(0, 1).map((r) => ({ ...r, text: want.words ?? '' })),
                },
              ]
            : []),
        ];
      });
      doc.transition = transition;
      const saved = await d.library.saveSlides(made.id, doc, opened.stamp);
      if (!saved.ok) throw new Error(saved.message);
      return made.id;
    },
    { name, slides, transition },
  );
}

/** Give every slide of a presentation another transition. */
export async function setTransition(win: Page, id: string, transition: Transition): Promise<void> {
  await win.evaluate(
    async ({ id, transition }) => {
      const d = (globalThis as PageGlobals).drashti;
      const opened = await d.library.slidesForEdit(id);
      if (!opened.ok) throw new Error(opened.message);
      opened.doc.transition = transition;
      const saved = await d.library.saveSlides(id, opened.doc, opened.stamp);
      if (!saved.ok) throw new Error(saved.message);
    },
    { id, transition },
  );
}

/** Put a presentation's slide up, as Next would. */
export const goLive = (win: Page, presentationId: string, slideIndex: number) =>
  win.evaluate(
    ({ presentationId, slideIndex }) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'goLive', presentationId, slideIndex }),
    { presentationId, slideIndex },
  );

/** The engine's state now. */
export const engineState = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** Tests only (DRASHTI_TEST_CLOCK_HOLD=1): every output's clock, and the stream's, held at `at`, or let go (null). */
export const holdClock = (app: ElectronApplication, at: number | null) =>
  app.evaluate(
    (_e, at) =>
      (globalThis as { drashtiTestHoldClock?: (at: number | null) => number }).drashtiTestHoldClock?.(at) ??
      0,
    at,
  );
