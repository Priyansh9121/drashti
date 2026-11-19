import { useEffect, useMemo, useState } from 'react';
import {
  chromiumFirstBaseline,
  deckFirstLineShift,
  type FontHeights,
  type LineLook,
} from '../../../shared/first-line';
import type { TextElement, TextRun } from '../../../shared/model';
import { cutLineHeight, sourceFitScale, sourceLineCut, sourceRunScale } from '../../../shared/source-fit';
import { type DrawnLine, drawnLines } from '../../../shared/text-lists';
import { fontFamilyFor } from './fonts';

/*
 * X20 (h-run6, Session 59): a deck's own box draws its first line where PowerPoint puts it (shared/first-line.ts, from
 * real-PowerPoint run 6), on the screens and in the slide editor alike. CSS lays a box's lines out with half their
 * leading above each font's own heights; PowerPoint does not (4-5 pt apart under 150%, 80% or exact spacing, 1-2 pt
 * single spaced). Its words are moved, all together, by the difference: drawn moved, laid out as before, so the lines'
 * gaps, the words' sizes and the box's fit (render/shrink-to-fit.ts measures the layout) stay as they are. A box made in
 * Drashti draws as it always has.
 */

/** A run's size in the box as the screens draw it (SlideView's ownSize: PowerPoint's own shrink, run by run). */
function drawnSize(px: number, el: TextElement): number {
  const share = sourceRunScale(el, px);
  return share === 1 ? px : Math.round(px * share * 10_000) / 10_000;
}

/** A drawn line as CSS lays it out: its first words' font, the line's size and its height (slide px at `fit`). */
function lineLook(
  line: DrawnLine,
  el: TextElement,
  heightsOf: (family: string) => FontHeights | null,
  fit: number,
): LineLook | null {
  const first: Omit<TextRun, 'text'> = line.pieces[0]?.run ?? line.end ?? {};
  // As ListedRuns sizes the line: its largest run's size where every run on it has one, else the box's.
  const sized = line.pieces.length > 0 ? line.pieces.map((p) => p.run.size) : [line.end?.size];
  const sizes = sized.filter((px): px is number => px !== undefined);
  const lineSize = sizes.length > 0 && sizes.length === sized.length ? Math.max(...sizes) : undefined;
  const size = drawnSize(lineSize ?? el.style.fontSize, el);
  const paragraph = first.paragraph;
  const multiple = cutLineHeight(paragraph?.lineHeight ?? el.style.lineHeight, sourceLineCut(el.style));
  const height = paragraph?.lineHeightPx ?? multiple * size;
  const font = heightsOf(fontFamilyFor(first.font ?? el.style.fontFamily, first.lang ?? el.lang));
  if (!font || !(size > 0) || !(height > 0)) return null;
  return { font, size: size * fit, line: height * fit };
}

/**
 * How far a deck box's words move down from where CSS lays them out (unfitted slide px; up when negative), or
 * undefined for a box that draws as it always has: one made in Drashti, one without a deck's paragraphs, one set
 * vertically.
 */
export function deckWordsShift(
  el: TextElement,
  heightsOf: (family: string) => FontHeights | null,
): number | undefined {
  if (el.sourceShapeId === undefined || !el.runs?.some((run) => run.paragraph)) return undefined;
  if (el.style.writingMode) return undefined;
  const lines = drawnLines(el.runs);
  // A deck's empty last paragraph draws as a line (SlideView's ListedRuns), in the look of the line before it.
  const tail = lines.at(-1);
  const before = lines.at(-2);
  if (lines.length > 1 && tail?.pieces.length === 0) {
    if (before?.end?.paragraph) tail.end = before.end;
    else lines.pop();
  }
  const firstLine = lines[0];
  const lastLine = lines.at(-1);
  if (!firstLine || !lastLine) return undefined;
  // Worked out at the size the box is drawn (Chromium rounds a font's heights to whole pixels there): PowerPoint's own
  // shrink where the box fits at it (render/shrink-to-fit.ts starts from it), else its full size; then given back
  // unfitted, as the box's fit (--fit) scales it.
  const fit = el.style.shrinkToFit === true ? (sourceFitScale(el) ?? 1) : 1;
  const first = lineLook(firstLine, el, heightsOf, fit);
  const last = lineLook(lastLine, el, heightsOf, fit);
  if (!first || !last) return undefined;
  const shift = deckFirstLineShift(el.style.verticalAlign, first, last, chromiumFirstBaseline) / fit;
  return Number.isFinite(shift) ? Math.round(shift * 1000) / 1000 : undefined;
}

const measured = new Map<string, FontHeights>();
let canvas: CanvasRenderingContext2D | null | undefined;

/**
 * A CSS font list's own heights above and below its baseline, as shares of its size, as this page draws it: its first
 * font this computer has (the one CSS sizes a line by). Kept once that font is ready; a bundled font still on its way
 * is measured again later.
 */
export function fontHeightsOf(family: string): FontHeights | null {
  const kept = measured.get(family);
  if (kept) return kept;
  // A page without a document (words drawn to markup in a test) measures nothing: its boxes draw as they always have.
  if (typeof document === 'undefined') return null;
  if (canvas === undefined) canvas = document.createElement('canvas').getContext('2d');
  if (!canvas) return null;
  const font = `1000px ${family}`;
  canvas.font = font;
  const metrics = canvas.measureText('H');
  const heights = {
    ascent: metrics.fontBoundingBoxAscent / 1000,
    descent: metrics.fontBoundingBoxDescent / 1000,
  };
  if (!(heights.ascent > 0) || !(heights.descent >= 0)) return null;
  if (document.fonts.check(font)) measured.set(family, heights);
  return heights;
}

/** A deck box's words' move (unfitted slide px), worked out again as fonts arrive. */
export function useDeckWordsShift(el: TextElement): number | undefined {
  const deck = el.sourceShapeId !== undefined;
  const [fonts, setFonts] = useState(0);
  useEffect(() => {
    if (!deck) return;
    const again = () => {
      setFonts((n) => n + 1);
    };
    document.fonts.addEventListener('loadingdone', again);
    return () => {
      document.fonts.removeEventListener('loadingdone', again);
    };
  }, [deck]);
  // Again whenever a font has arrived (`fonts` counts them), as one still on its way measures as its fallback.
  return useMemo(
    () => (deck && fonts >= 0 ? deckWordsShift(el, fontHeightsOf) : undefined),
    [el, deck, fonts],
  );
}
