import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readZipEntries } from '../zip';
import { DECK_HEIGHT, makeTestDeck, placeholderDeckMedia } from './make-deck';
import { makeZip } from './zip-writer';

/*
 * Tests only (h-pptx3, Session 58): PF-12's stills, for a real PowerPoint run that makes their movie (the comparison
 * harness, s58-notes/logs/h-pptx3/harness: export ... stills). What Drashti's reader assumes about spacing and tables
 * and nobody has seen real PowerPoint draw (the review of C15's 12c35e3d, LOW-1, and of 0b15c784):
 * - spcPct's base: Drashti takes the text size (ECMA-376's words, as LibreOffice); if PowerPoint takes the line, a
 *   percentage is about 1/6 short. 40 pt words, so the two differ by about 6 pt (12 pixels of a 1080-line movie);
 * - the first/last-paragraph rule: space before a box's first paragraph and after its last is dropped unless its
 *   bodyPr says spcFirstLastPara (Drashti's reading of ECMA-376);
 * - PowerPoint's own default table style, Medium Style 2 - Accent 1, on a light deck and on a dark one (the master's
 *   colour map turned round), with Office's own accent 1 (#4472C4), whose body rows PowerPoint is known to draw
 *   #E9EBF5 and #CFD5EA.
 * Placeholder words only. Each slide carries the motion decks' gray marker in its top left corner (from 20, 4 lighter
 * a slide), so the harness finds it in the movie; no clicks and no transitions: each slide is held as a still.
 */

/** PowerPoint's own default table style (its GUID), as it names it in a deck's tableStyles.xml. */
export const DEFAULT_TABLE_STYLE = '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}';
const INCH = 914_400;
const EMU_PER_GRID_PX = DECK_HEIGHT / 180;

/** Space before or after a paragraph: a percentage (spcPct, thousandths of a percent) or points (spcPts, hundredths). */
export type StillsSpace = { pct: number } | { pts: number };
export interface StillsParagraph {
  text: string;
  before?: StillsSpace;
  after?: StillsSpace;
  /** Its words' own size, hundredths of a point (the slide's unless given). */
  size?: number;
}
export interface StillsSlide {
  name: string;
  marker: number;
  /** The words' box (EMU), or the table's. */
  box: { x: number; y: number; w: number; h: number };
  anchor?: 't' | 'b';
  /** bodyPr's spcFirstLastPara="1". */
  firstLastPara?: boolean;
  paragraphs?: StillsParagraph[];
  /**
   * A table of placeholder words, its first row a header and its rows banded: in PowerPoint's default style unless
   * another is named (by its ID alone, as a deck that does not save the style's definition), its columns banded too
   * where `bandCol` says so, or every part of it on (`every`: first and last row, first and last column, banded rows).
   */
  table?: { rows: number; columns: number; style?: string; bandCol?: boolean; every?: boolean };
  /** The slide this one is measured against (its spacing, or its words' sizes, unshrunk). */
  control?: string;
  /** Each paragraph's line spacing fixed in points (lnSpc spcPts, hundredths of a point). */
  lineSpacingPoints?: number;
  /** Swatches: each a filled rectangle, its fill a DrawingML colour as written inside a:solidFill. */
  swatches?: { name: string; color: string }[];
  /** The words' size, hundredths of a point (4000 unless given). */
  size?: number;
  /** Each paragraph's line spacing, a percentage of a line (lnSpc spcPct; none written for 100). */
  lineSpacing?: number;
  /** Each paragraph a bullet (•, Arial), as PowerPoint's default list. */
  bullets?: boolean;
  /**
   * PowerPoint's own shrink of words that run past the box (normAutofit), in thousandths of a percent as it saves them:
   * the words at fontScale of their size, every line spacing lnSpcReduction less. None: noAutofit.
   */
  fit?: { fontScale: number; lnSpcReduction?: number };
  /** The words' typeface (Arial unless given), for Latin and complex scripts alike. */
  font?: string;
}
export interface StillsDeck {
  file: string;
  /** The master's colour map turned round (bg1 = dk1, tx1 = lt1, ...), as a dark theme has it. */
  dark: boolean;
  slides: readonly StillsSlide[];
  /** Office's own theme colours throughout (else the placeholder theme with Office's accent 1). */
  office?: boolean;
  /** More table styles (a:tblStyle) written into the deck's tableStyles.xml after PowerPoint's default one. */
  tableStyles?: string;
}

const WORDS_BOX = { x: 1.5 * INCH, y: 1.2 * INCH, w: 9 * INCH, h: 4.8 * INCH };
const TABLE_BOX = { x: 1.5 * INCH, y: 1.4 * INCH, w: 9 * INCH, h: 4 * INCH };
const lines = (spaces: { before?: StillsSpace; after?: StillsSpace }[]): StillsParagraph[] =>
  ['one', 'two', 'three'].map((n, i) => ({ text: `Placeholder line ${n}`, ...spaces[i] }));
const pct = (percent: number): StillsSpace => ({ pct: percent * 1000 });
const marked = (slides: Omit<StillsSlide, 'marker'>[]): StillsSlide[] =>
  slides.map((slide, i) => ({ ...slide, marker: 20 + 4 * i }));

/** The light deck: the spacing stills and the default-style table. */
export const STILLS_LIGHT: StillsDeck = {
  file: 'Placeholder PowerPoint stills.pptx',
  dark: false,
  slides: marked([
    { name: 'Spacing · none', box: WORDS_BOX, paragraphs: lines([]) },
    {
      name: 'Spacing · before 100% (spcPct)',
      box: WORDS_BOX,
      paragraphs: lines([{}, { before: pct(100) }, { before: pct(100) }]),
    },
    {
      name: 'Spacing · before 50%, after 100% (spcPct)',
      box: WORDS_BOX,
      paragraphs: lines([{ after: pct(100) }, { before: pct(50) }]),
    },
    {
      name: 'Spacing · before 24 pt (spcPts)',
      box: WORDS_BOX,
      paragraphs: lines([{}, { before: { pts: 2400 } }, { before: { pts: 2400 } }]),
    },
    {
      name: 'Edges · before the first paragraph, top',
      box: WORDS_BOX,
      paragraphs: lines([{ before: pct(100) }]),
    },
    {
      name: 'Edges · before the first paragraph, spcFirstLastPara',
      box: WORDS_BOX,
      firstLastPara: true,
      paragraphs: lines([{ before: pct(100) }]),
    },
    { name: 'Edges · none, bottom', box: WORDS_BOX, anchor: 'b', paragraphs: lines([]) },
    {
      name: 'Edges · after the last paragraph, bottom',
      box: WORDS_BOX,
      anchor: 'b',
      paragraphs: lines([{}, {}, { after: pct(100) }]),
    },
    {
      name: 'Edges · after the last paragraph, bottom, spcFirstLastPara',
      box: WORDS_BOX,
      anchor: 'b',
      firstLastPara: true,
      paragraphs: lines([{}, {}, { after: pct(100) }]),
    },
    { name: 'Table · default style, light', box: TABLE_BOX, table: { rows: 4, columns: 3 } },
  ]),
};

/** The dark deck: the same table, and words in the theme's text colour as a control of the colour map. */
export const STILLS_DARK: StillsDeck = {
  file: 'Placeholder PowerPoint stills dark.pptx',
  dark: true,
  slides: marked([
    { name: 'Table · default style, dark', box: TABLE_BOX, table: { rows: 4, columns: 3 } },
    { name: 'Words · the theme’s text colour, dark', box: WORDS_BOX, paragraphs: lines([]) },
  ]),
};

/*
 * PF-4b (h-pptx3, 14 Nov evening): boxes whose words run past them at full size, each with the shrink PowerPoint saves
 * (normAutofit fontScale and lnSpcReduction, in its own steps), the box as tall as the words take at that shrink (and
 * a fiftieth more), so that PowerPoint's own fit lands on it. Lines short enough never to wrap, so the measure reads
 * sizes and places alone: each line's ink (no letter below its line). Two boxes that fit unshrunk are the measure's own
 * controls.
 */
const SHRINK_X = 1.5 * INCH;
const SHRINK_Y = 0.6 * INCH;
const SHRINK_W = 9 * INCH;
const POINT = 12_700;
/** Each line's own letter: none hangs below the line, so a line's lowest ink is its baseline. */
const NUMBERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const shrinkLines = (count: number, words = (n: string) => `Placeholder line ${n}`): StillsParagraph[] =>
  NUMBERS.slice(0, count).map((n) => ({ text: words(n) }));
/** A box as tall as `count` lines of `size` take at the shrink given (PowerPoint's line: 1.2 x the size), insets too. */
function shrinkBox(
  count: number,
  size: number,
  spacing: number,
  fit?: StillsSlide['fit'],
): StillsSlide['box'] {
  const scale = (fit?.fontScale ?? 100_000) / 100_000;
  const cut = (fit?.lnSpcReduction ?? 0) / 1000;
  const line = 1.2 * (size / 100) * scale * ((spacing - cut) / 100);
  const points = fit ? (count * line + 7.2) * 1.02 : count * 1.2 * (size / 100) * (spacing / 100) * 1.1 + 7.2;
  return { x: SHRINK_X, y: SHRINK_Y, w: SHRINK_W, h: Math.round(points * POINT) };
}
const shrinkSlide = (
  name: string,
  count: number,
  size: number,
  spacing: number,
  fit?: StillsSlide['fit'],
  more: Partial<StillsSlide> = {},
): Omit<StillsSlide, 'marker'> => ({
  name,
  box: shrinkBox(count, size, spacing, fit),
  paragraphs: shrinkLines(count),
  size,
  ...(spacing === 100 ? {} : { lineSpacing: spacing }),
  ...(fit ? { fit } : {}),
  ...more,
});

/** PF-4b's stills: boxes PowerPoint shrinks, and two that fit unshrunk (the measure's controls). */
export const STILLS_SHRINK: StillsDeck = {
  file: 'Placeholder PowerPoint shrink.pptx',
  dark: false,
  slides: marked([
    shrinkSlide('No shrink · 28 pt, lines 100% (control)', 8, 2800, 100),
    shrinkSlide('No shrink · 40 pt, lines 90% (control)', 6, 4000, 90),
    shrinkSlide('Shrink · 28 pt, lines 100%, fontScale 77.5%, 20% less', 8, 2800, 100, {
      fontScale: 77_500,
      lnSpcReduction: 20_000,
    }),
    shrinkSlide('Shrink · 40 pt, lines 90%, fontScale 62.5%, 20% less', 6, 4000, 90, {
      fontScale: 62_500,
      lnSpcReduction: 20_000,
    }),
    shrinkSlide('Shrink · 24 pt, lines 120%, fontScale 85%, 10% less', 8, 2400, 120, {
      fontScale: 85_000,
      lnSpcReduction: 10_000,
    }),
    shrinkSlide('Shrink · 32 pt, lines 150%, fontScale 70%, 20% less', 6, 3200, 150, {
      fontScale: 70_000,
      lnSpcReduction: 20_000,
    }),
    shrinkSlide(
      'Shrink · 28 pt bullets, fontScale 77.5%, 10% less',
      7,
      2800,
      100,
      {
        fontScale: 77_500,
        lnSpcReduction: 10_000,
      },
      { bullets: true },
    ),
    shrinkSlide('Shrink · 28 pt, fontScale 92.5% only', 8, 2800, 100, { fontScale: 92_500 }),
    shrinkSlide(
      'Shrink · Gujarati placeholder, 32 pt, fontScale 85%, 10% less',
      5,
      3200,
      100,
      {
        fontScale: 85_000,
        lnSpcReduction: 10_000,
      },
      { paragraphs: shrinkLines(5, () => 'નમૂના નમૂના નમૂના'), font: 'Gujarati Sangam MN' },
    ),
  ]),
};

/*
 * Run 5 (h-pptx3, 14 Nov night): what Drashti now assumes and nobody has seen real PowerPoint draw.
 * - C17: a percentage paragraph spacing (spcPct) under a paragraph's own line spacing. Drashti takes that share of the
 *   paragraph's line as spaced (40 pt words, lines 150%: before 100% is 72 pt; lines 80%: 38.4 pt; lines exactly 36 pt:
 *   50% is 18 pt); if PowerPoint takes its single line (48 pt) instead, the two differ by 9.6-24 pt (19-48 pixels of a
 *   1080-line movie). Each spaced slide has a control with the same line spacing and no paragraph spacing, so the
 *   measure reads the spacing alone (the baselines' gaps less the control's).
 * - PF-4b: a shrunk box whose words have two sizes. Drashti draws every run at one fit, the box's main size rounded to
 *   a whole point (40 pt at 62.5% is 25 pt, so its 18 pt is 11.25); if PowerPoint rounds each run's own size (11 pt),
 *   the smaller lines are 2-2.4% narrower (6-10 pixels of their width). Six lines, the larger size and the smaller by
 *   turns, none with a letter below its line; each slide against the same words unshrunk (its control), line by line.
 */
const RUN5_WORDS_BOX = { x: 1.5 * INCH, y: 0.9 * INCH, w: 9 * INCH, h: 6 * INCH };
/** A control with the line spacing given and no paragraph spacing, and the same with `before` on its later paragraphs. */
const spacingPair = (
  label: string,
  spacing: Pick<StillsSlide, 'lineSpacing' | 'lineSpacingPoints'>,
  before: StillsSpace,
  beforeLabel: string,
): Omit<StillsSlide, 'marker'>[] => {
  const control = `Spacing · lines ${label}, none (control)`;
  return [
    { name: control, box: RUN5_WORDS_BOX, paragraphs: lines([]), ...spacing },
    {
      name: `Spacing · lines ${label}, before ${beforeLabel}`,
      box: RUN5_WORDS_BOX,
      paragraphs: lines([{}, { before }, { before }]),
      ...spacing,
      control,
    },
  ];
};
/** Six lines, the larger size and the smaller by turns: the larger lines have the most letters (the box's main size). */
const mixedLines = (large: number, small: number): StillsParagraph[] =>
  NUMBERS.slice(0, 6).map((n, i) =>
    i % 2 === 0
      ? { text: `Placeholder title words in line ${n}`, size: large }
      : { text: `Placeholder smaller words ${n}`, size: small },
  );
/** As shrinkBox, line by line: each line 1.2 x its size, all at the main size's fit rounded to a whole point. */
function mixedBox(paragraphs: StillsParagraph[], fit?: StillsSlide['fit']): StillsSlide['box'] {
  const sizes = paragraphs.map((p) => (p.size ?? 4000) / 100);
  const main = Math.max(...sizes);
  const scale = fit ? Math.round((main * fit.fontScale) / 100_000) / main : 1;
  const cut = (fit?.lnSpcReduction ?? 0) / 1000;
  const words = sizes.reduce((sum, size) => sum + 1.2 * size * scale * ((100 - cut) / 100), 0);
  const points = fit ? (words + 7.2) * 1.02 : words * 1.1 + 7.2;
  return { x: SHRINK_X, y: SHRINK_Y, w: SHRINK_W, h: Math.round(points * POINT) };
}
const mixedPair = (
  large: number,
  small: number,
  fit: NonNullable<StillsSlide['fit']>,
): Omit<StillsSlide, 'marker'>[] => {
  const label = `${String(large / 100)} and ${String(small / 100)} pt`;
  const control = `Mixed · ${label} unshrunk (control)`;
  const paragraphs = mixedLines(large, small);
  return [
    { name: control, box: mixedBox(paragraphs), paragraphs, size: large },
    {
      name: `Mixed · ${label} at ${String(fit.fontScale / 1000)}%`,
      box: mixedBox(paragraphs, fit),
      paragraphs,
      size: large,
      fit,
      control,
    },
  ];
};

/** Run 5's words: C17's spacing under a paragraph's own line spacing, and PF-4b's shrink of two sizes in one box. */
export const STILLS_RUN5_WORDS: StillsDeck = {
  file: 'Placeholder PowerPoint run5 words.pptx',
  dark: false,
  slides: marked([
    ...spacingPair('150%', { lineSpacing: 150 }, pct(100), '100%'),
    ...spacingPair('80%', { lineSpacing: 80 }, pct(100), '100%'),
    ...spacingPair('exactly 36 pt', { lineSpacingPoints: 3600 }, pct(50), '50%'),
    ...mixedPair(4000, 1800, { fontScale: 62_500, lnSpcReduction: 20_000 }),
    ...mixedPair(3600, 2400, { fontScale: 70_000, lnSpcReduction: 20_000 }),
    ...mixedPair(3200, 2000, { fontScale: 77_500, lnSpcReduction: 10_000 }),
  ]),
};

const esc = (text: string) => text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
const spaceXml = (tag: 'spcBef' | 'spcAft', space: StillsSpace | undefined) =>
  space === undefined
    ? ''
    : `<a:${tag}>${'pct' in space ? `<a:spcPct val="${String(space.pct)}"/>` : `<a:spcPts val="${String(space.pts)}"/>`}</a:${tag}>`;
/** A run of words: in the theme's text colour (tx1, which the dark deck's colour map turns white), or the table style's. */
const runXml = (text: string, size: number, themeText = true, font = 'Arial') =>
  `<a:r><a:rPr lang="${/[\u0A80-\u0AFF]/u.test(text) ? 'gu-IN' : 'en-US'}" sz="${String(size)}" dirty="0">${themeText ? '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>' : ''}<a:latin typeface="${esc(font)}"/><a:cs typeface="${esc(font)}"/></a:rPr><a:t>${esc(text)}</a:t></a:r>`;
const xfrm = (box: StillsSlide['box'], tag = 'a:xfrm') =>
  `<${tag}><a:off x="${String(Math.round(box.x))}" y="${String(Math.round(box.y))}"/><a:ext cx="${String(Math.round(box.w))}" cy="${String(Math.round(box.h))}"/></${tag}>`;

function wordsXml(slide: StillsSlide): string {
  const lineSpacing =
    slide.lineSpacingPoints !== undefined
      ? `<a:lnSpc><a:spcPts val="${String(slide.lineSpacingPoints)}"/></a:lnSpc>`
      : slide.lineSpacing === undefined
        ? ''
        : `<a:lnSpc><a:spcPct val="${String(slide.lineSpacing * 1000)}"/></a:lnSpc>`;
  const list = slide.bullets ? ' marL="342900" indent="-342900"' : '';
  const bullet = slide.bullets ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : '<a:buNone/>';
  const paragraphs = (slide.paragraphs ?? [])
    .map(
      (p) =>
        `<a:p><a:pPr${list}>${lineSpacing}${spaceXml('spcBef', p.before)}${spaceXml('spcAft', p.after)}${bullet}</a:pPr>${runXml(p.text, p.size ?? slide.size ?? 4000, true, slide.font)}</a:p>`,
    )
    .join('');
  const fit = slide.fit
    ? `<a:normAutofit fontScale="${String(slide.fit.fontScale)}"${slide.fit.lnSpcReduction ? ` lnSpcReduction="${String(slide.fit.lnSpcReduction)}"` : ''}/>`
    : '<a:noAutofit/>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Placeholder words"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(slide.box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="${slide.anchor ?? 't'}"${slide.firstLastPara ? ' spcFirstLastPara="1"' : ''}>${fit}</a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function tableXml(slide: StillsSlide): string {
  const { rows, columns } = slide.table ?? { rows: 0, columns: 0 };
  const width = Math.round(slide.box.w / columns);
  const height = Math.round(slide.box.h / rows);
  const cell = (r: number, c: number) =>
    `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${runXml(r === 0 ? `Heading ${String(c + 1)}` : `Cell ${String(r)}.${String(c + 1)}`, 1800, false)}</a:p></a:txBody><a:tcPr/></a:tc>`;
  const body = Array.from(
    { length: rows },
    (_, r) =>
      `<a:tr h="${String(height)}">${Array.from({ length: columns }, (__, c) => cell(r, c)).join('')}</a:tr>`,
  ).join('');
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Placeholder table"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>${xfrm(slide.box, 'p:xfrm')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr ${slide.table?.every ? 'firstRow="1" firstCol="1" lastRow="1" lastCol="1" bandRow="1"' : `firstRow="1" bandRow="1"${slide.table?.bandCol ? ' bandCol="1"' : ''}`}><a:tableStyleId>${slide.table?.style ?? DEFAULT_TABLE_STYLE}</a:tableStyleId></a:tblPr><a:tblGrid>${`<a:gridCol w="${String(width)}"/>`.repeat(columns)}</a:tblGrid>${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

/** Swatches: 6 a row (3 rows at most), 1.75 x 1.5 in each, 0.25 in apart, from (0.8, 1.0) in; no outline. */
export const SWATCH = {
  x: 0.8 * INCH,
  y: 1.0 * INCH,
  w: 1.75 * INCH,
  h: 1.5 * INCH,
  gap: 0.25 * INCH,
  perRow: 6,
};
function swatchesXml(slide: StillsSlide): string {
  return (slide.swatches ?? [])
    .map((swatch, i) => {
      const box = {
        x: SWATCH.x + (i % SWATCH.perRow) * (SWATCH.w + SWATCH.gap),
        y: SWATCH.y + Math.floor(i / SWATCH.perRow) * (SWATCH.h + SWATCH.gap),
        w: SWATCH.w,
        h: SWATCH.h,
      };
      return `<p:sp><p:nvSpPr><p:cNvPr id="${String(10 + i)}" name="${esc(swatch.name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill>${swatch.color}</a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
    })
    .join('');
}

const line = (side: string, width: number) =>
  `<a:${side}><a:ln w="${String(width)}" cmpd="sng"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:${side}>`;
const fill = (tint?: number) =>
  `<a:fill><a:solidFill><a:schemeClr val="accent1">${tint === undefined ? '' : `<a:tint val="${String(tint)}"/>`}</a:schemeClr></a:solidFill></a:fill>`;
const bold =
  '<a:tcTxStyle b="on"><a:fontRef idx="minor"><a:prstClr val="black"/></a:fontRef><a:schemeClr val="lt1"/></a:tcTxStyle>';
/** Medium Style 2 - Accent 1, as PowerPoint writes it into a deck's tableStyles.xml. */
const TABLE_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="${DEFAULT_TABLE_STYLE}"><a:tblStyle styleId="${DEFAULT_TABLE_STYLE}" styleName="Medium Style 2 - Accent 1"><a:wholeTbl><a:tcTxStyle><a:fontRef idx="minor"><a:prstClr val="black"/></a:fontRef><a:schemeClr val="dk1"/></a:tcTxStyle><a:tcStyle><a:tcBdr>${['left', 'right', 'top', 'bottom', 'insideH', 'insideV'].map((side) => line(side, 12_700)).join('')}</a:tcBdr>${fill(20_000)}</a:tcStyle></a:wholeTbl><a:band1H><a:tcStyle><a:tcBdr/>${fill(40_000)}</a:tcStyle></a:band1H><a:band2H><a:tcStyle><a:tcBdr/></a:tcStyle></a:band2H><a:band1V><a:tcStyle><a:tcBdr/>${fill(40_000)}</a:tcStyle></a:band1V><a:band2V><a:tcStyle><a:tcBdr/></a:tcStyle></a:band2V><a:lastCol>${bold}<a:tcStyle><a:tcBdr/>${fill()}</a:tcStyle></a:lastCol><a:firstCol>${bold}<a:tcStyle><a:tcBdr/>${fill()}</a:tcStyle></a:firstCol><a:lastRow>${bold}<a:tcStyle><a:tcBdr>${line('top', 38_100)}</a:tcBdr>${fill()}</a:tcStyle></a:lastRow><a:firstRow>${bold}<a:tcStyle><a:tcBdr>${line('bottom', 38_100)}</a:tcBdr>${fill()}</a:tcStyle></a:firstRow></a:tblStyle></a:tblStyleLst>`;

const TABLE_STYLES_REL =
  '<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>';
const TABLE_STYLES_TYPE =
  '<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>';

/*
 * Run 5's tables (h-pptx3, for X14): Office's own theme colours, so PowerPoint's well-known shades can be checked too.
 * - Swatches of colours changed in HSL whose exact value is a half (white at lumMod 50% is 127.5): Drashti rounds a half
 *   up; which way PowerPoint goes is unseen. Odd tenths of white darkened and of black lightened all land on a half,
 *   as do pure red and green at lumMod 50% and blue at lumOff -25%; four plain colours are the controls (an export
 *   that changes colours shows there). Office's own theme shades (its colour picker's lighter and darker rows) and
 *   tints, shades and see-through fills as the table styles use them.
 * - A table banded by row and by column (the cell where both fill: which wins, or how they mix), in PowerPoint's
 *   default style, five other families, and two placeholder styles of the deck's own whose bands differ (opaque, and
 *   half see-through).
 * - PowerPoint's table style families beyond Medium Style 2 and the plain ones, named by their IDs alone (as a deck
 *   that does not save a style's definition): two of each family, with the flags PowerPoint gives a new table (header
 *   row, banded rows), and seven with every part on (first and last row and column).
 * Swatches cannot carry words, so the measure names each by its place (SWATCH: 6 a row, by rows).
 */
const OFFICE_COLORS: Record<string, string> = {
  dk1: '000000',
  lt1: 'FFFFFF',
  dk2: '44546A',
  lt2: 'E7E6E6',
  accent1: '4472C4',
  accent2: 'ED7D31',
  accent3: 'A5A5A5',
  accent4: 'FFC000',
  accent5: '5B9BD5',
  accent6: '70AD47',
  hlink: '0563C1',
  folHlink: '954F72',
};
const RUN5_TABLE = { rows: 5, columns: 4 };
const change = (kind: string, percent: number) => `<a:${kind} val="${String(percent * 1000)}"/>`;
const srgb = (rgb: string, ...changes: string[]) =>
  changes.length ? `<a:srgbClr val="${rgb}">${changes.join('')}</a:srgbClr>` : `<a:srgbClr val="${rgb}"/>`;
const scheme = (role: string, ...changes: string[]) =>
  changes.length
    ? `<a:schemeClr val="${role}">${changes.join('')}</a:schemeClr>`
    : `<a:schemeClr val="${role}"/>`;
const HALVES: StillsSlide['swatches'] = [
  { name: 'White, lumMod 50%', color: srgb('FFFFFF', change('lumMod', 50)) },
  { name: 'Black, lumOff 50%', color: srgb('000000', change('lumOff', 50)) },
  { name: 'Black, lumMod 50% lumOff 50%', color: srgb('000000', change('lumMod', 50), change('lumOff', 50)) },
  ...[10, 30, 70, 90].map((n) => ({
    name: `White, lumMod ${String(n)}%`,
    color: srgb('FFFFFF', change('lumMod', n)),
  })),
  ...[10, 30, 70, 90].map((n) => ({
    name: `Black, lumOff ${String(n)}%`,
    color: srgb('000000', change('lumOff', n)),
  })),
  { name: 'Red, lumMod 50%', color: srgb('FF0000', change('lumMod', 50)) },
  { name: 'Green, lumMod 50%', color: srgb('00FF00', change('lumMod', 50)) },
  { name: 'Blue, lumOff -25%', color: srgb('0000FF', change('lumOff', -25)) },
  ...['7F7F7F', '808080', '4472C4', 'ED7D31'].map((rgb) => ({ name: `Control ${rgb}`, color: srgb(rgb) })),
];
const SHADES: StillsSlide['swatches'] = [
  ...(['accent1', 'accent2'] as const).flatMap((role) => [
    { name: `${role}, lighter 80%`, color: scheme(role, change('lumMod', 20), change('lumOff', 80)) },
    { name: `${role}, lighter 60%`, color: scheme(role, change('lumMod', 40), change('lumOff', 60)) },
    { name: `${role}, lighter 40%`, color: scheme(role, change('lumMod', 60), change('lumOff', 40)) },
    { name: `${role}, darker 25%`, color: scheme(role, change('lumMod', 75)) },
    { name: `${role}, darker 50%`, color: scheme(role, change('lumMod', 50)) },
  ]),
  { name: 'accent6, lighter 60%', color: scheme('accent6', change('lumMod', 40), change('lumOff', 60)) },
  { name: 'accent6, darker 50%', color: scheme('accent6', change('lumMod', 50)) },
  ...[95, 85, 65, 50].map((n) => ({
    name: `bg1, darker ${String(100 - n)}%`,
    color: scheme('bg1', change('lumMod', n)),
  })),
  ...[85, 65, 50].map((n) => ({
    name: `tx1, lighter ${String(100 - n)}%`,
    color: scheme('tx1', change('lumMod', n), change('lumOff', 100 - n)),
  })),
];
const TINTS: StillsSlide['swatches'] = [
  ...[20, 40, 60, 80].map((n) => ({
    name: `accent1, tint ${String(n)}%`,
    color: scheme('accent1', change('tint', n)),
  })),
  ...[20, 40, 60, 80].map((n) => ({
    name: `accent1, shade ${String(n)}%`,
    color: scheme('accent1', change('shade', n)),
  })),
  { name: 'accent2, tint 40%', color: scheme('accent2', change('tint', 40)) },
  { name: 'accent2, shade 60%', color: scheme('accent2', change('shade', 60)) },
  { name: 'accent6, tint 20%', color: scheme('accent6', change('tint', 20)) },
  { name: 'accent6, shade 50%', color: scheme('accent6', change('shade', 50)) },
  ...[20, 40, 60, 80].map((n) => ({
    name: `dk1, tint ${String(n)}%`,
    color: scheme('dk1', change('tint', n)),
  })),
  ...[20, 40].map((n) => ({
    name: `accent1, alpha ${String(n)}%`,
    color: scheme('accent1', change('alpha', n)),
  })),
];

/** PowerPoint's own table styles by name and ID (as its decks name them; their definitions are PowerPoint's). */
export const TABLE_STYLE_IDS: Readonly<Record<string, string>> = {
  'Themed Style 1 - Accent 1': '{3C2FFA5D-87B4-456A-9821-1D502468CF0F}',
  'Themed Style 1 - Accent 2': '{284E427A-3D55-4303-BF80-6455036E1DE7}',
  'Themed Style 2 - Accent 1': '{D113A9D2-9D6B-4929-AA2D-F23B5EE8CBE7}',
  'Themed Style 2 - Accent 6': '{638B1855-1B75-4FBE-930C-398BA8C253C6}',
  'Light Style 1': '{9D7B26C5-4107-4FEC-AEDC-1716B250EE53}',
  'Light Style 1 - Accent 1': '{3B4B98B0-60AC-42C2-AFA5-B58CD77FA1E5}',
  'Light Style 2 - Accent 1': '{69012ECD-51FC-41F1-AA8D-1B2483CD663E}',
  'Light Style 2 - Accent 2': '{72833802-FEF1-4C79-8D5D-14CF1EAF98D9}',
  'Light Style 3': '{616DA210-FB5B-4158-B5E0-FEB733F419BA}',
  'Light Style 3 - Accent 1': '{BC89EF96-8CEA-46FF-86C4-4CE0E7609802}',
  'Medium Style 1 - Accent 1': '{B301B821-A1FF-4177-AEE7-76D212191A09}',
  'Medium Style 1 - Accent 2': '{9DCAF9ED-07DC-4A11-8D7F-57B35C25682E}',
  'Medium Style 2': '{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}',
  'Medium Style 2 - Accent 1': DEFAULT_TABLE_STYLE,
  'Medium Style 2 - Accent 2': '{21E4AEA4-8DFA-4A89-87EB-49C32662AFE8}',
  'Medium Style 3 - Accent 1': '{6E25E649-3F16-4E02-A733-19D2CDBF48F0}',
  'Medium Style 3 - Accent 2': '{85BE263C-DBD7-4A20-BB59-AAB30ACAA65A}',
  'Medium Style 4 - Accent 1': '{69CF1AB2-1976-4502-BF36-3FF5EA218861}',
  'Medium Style 4 - Accent 6': '{16D9F66E-5EB9-4882-86FB-DCBF35E3C3E4}',
  'Dark Style 1 - Accent 1': '{125E5076-3810-47DD-B79F-674D7AD40C01}',
  'Dark Style 1 - Accent 2': '{37CE84F3-28C3-443E-9E96-99CF82512B78}',
  'Dark Style 2': '{5202B0CA-FC54-4496-8BCA-5EF66A818D29}',
  'Dark Style 2 - Accent 1/Accent 2': '{0660B408-B3CF-4A94-85FC-2B1E0A45F4A2}',
  'No Style, Table Grid': '{5940675A-B579-460E-94D1-54222C63F5DA}',
};
/** The deck's own two placeholder styles: rows banded in accent 2, columns in accent 6 (opaque; half see-through). */
const PLACEHOLDER_BANDS = '{D2A6E8B4-1C3F-4E5A-9B7D-2F4C6E8A0B13}';
const PLACEHOLDER_BANDS_HALF = '{D2A6E8B4-1C3F-4E5A-9B7D-2F4C6E8A0B14}';
const bandFill = (role: string, how: string) =>
  `<a:fill><a:solidFill>${scheme(role, how)}</a:solidFill></a:fill>`;
const placeholderBands = (id: string, name: string, how: string) =>
  `<a:tblStyle styleId="${id}" styleName="${name}"><a:wholeTbl><a:tcTxStyle><a:fontRef idx="minor"><a:prstClr val="black"/></a:fontRef><a:schemeClr val="dk1"/></a:tcTxStyle><a:tcStyle><a:tcBdr>${['left', 'right', 'top', 'bottom', 'insideH', 'insideV'].map((side) => line(side, 12_700)).join('')}</a:tcBdr><a:fill><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:fill></a:tcStyle></a:wholeTbl><a:band1H><a:tcStyle><a:tcBdr/>${bandFill('accent2', how)}</a:tcStyle></a:band1H><a:band2H><a:tcStyle><a:tcBdr/></a:tcStyle></a:band2H><a:band1V><a:tcStyle><a:tcBdr/>${bandFill('accent6', how)}</a:tcStyle></a:band1V><a:band2V><a:tcStyle><a:tcBdr/></a:tcStyle></a:band2V><a:firstRow>${bold}<a:tcStyle><a:tcBdr/>${fill()}</a:tcStyle></a:firstRow></a:tblStyle>`;
const tableSlide = (style: string, more: Partial<NonNullable<StillsSlide['table']>> = {}, label = style) => ({
  name: `Table · ${label}`,
  box: TABLE_BOX,
  table: { ...RUN5_TABLE, style: TABLE_STYLE_IDS[style] ?? style, ...more },
});
const BANDED_BOTH = [
  'Medium Style 2 - Accent 1',
  'Light Style 1 - Accent 1',
  'Light Style 3 - Accent 1',
  'Medium Style 3 - Accent 1',
  'Medium Style 4 - Accent 1',
  'Dark Style 1 - Accent 1',
  'Themed Style 1 - Accent 1',
];
const EVERY_PART = [
  'Medium Style 2 - Accent 1',
  'Light Style 1 - Accent 1',
  'Light Style 3 - Accent 1',
  'Medium Style 3 - Accent 1',
  'Medium Style 4 - Accent 1',
  'Dark Style 1 - Accent 1',
  'Themed Style 2 - Accent 1',
];

/** Run 5's tables and colours, for X14. */
export const STILLS_RUN5_TABLES: StillsDeck = {
  file: 'Placeholder PowerPoint run5 tables.pptx',
  dark: false,
  office: true,
  tableStyles:
    placeholderBands(PLACEHOLDER_BANDS, 'Placeholder bands', change('tint', 40)) +
    placeholderBands(PLACEHOLDER_BANDS_HALF, 'Placeholder bands, half see-through', change('alpha', 50)),
  slides: marked([
    { name: 'Colours · halves', box: TABLE_BOX, swatches: HALVES },
    { name: 'Colours · theme shades', box: TABLE_BOX, swatches: SHADES },
    { name: 'Colours · tints, shades and see-through', box: TABLE_BOX, swatches: TINTS },
    ...Object.keys(TABLE_STYLE_IDS)
      .filter((style) => style !== 'Medium Style 2 - Accent 1')
      .map((style) => tableSlide(style)),
    ...BANDED_BOTH.map((style) => tableSlide(style, { bandCol: true }, `${style}, rows and columns banded`)),
    tableSlide(
      PLACEHOLDER_BANDS,
      { bandCol: true },
      'Placeholder bands (rows accent 2, columns accent 6), rows and columns banded',
    ),
    tableSlide(
      PLACEHOLDER_BANDS_HALF,
      { bandCol: true },
      'Placeholder bands half see-through (rows accent 2, columns accent 6), rows and columns banded',
    ),
    ...EVERY_PART.map((style) => tableSlide(style, { every: true }, `${style}, every part on`)),
  ]),
};

/** Write a stills deck into `work` (its base deck beside it); returns its path. */
export async function writeStillsDeck(work: string, deck: StillsDeck): Promise<string> {
  const base = join(work, `base ${deck.file}`);
  const source = join(work, deck.file);
  await writeFile(
    base,
    makeTestDeck(
      deck.slides.map((slide) => ({
        key: slide.name,
        bg: 'FFFFFF',
        notes: '',
        transition: { kind: '', dur: 0 },
        shapes: [
          {
            id: 90,
            type: 'shape' as const,
            name: 'Placeholder marker',
            fill: slide.marker.toString(16).padStart(2, '0').repeat(3),
            x: Math.round(4 * EMU_PER_GRID_PX),
            y: Math.round(4 * EMU_PER_GRID_PX),
            w: Math.round(14 * EMU_PER_GRID_PX),
            h: Math.round(14 * EMU_PER_GRID_PX),
          },
        ],
        effects: [],
      })),
      placeholderDeckMedia(),
    ),
  );
  const entries = await readZipEntries(base, () => true);
  const text = (name: string) => {
    const part = entries.get(name);
    if (!part) throw new Error(`Missing generated part ${name}`);
    return part.toString('utf8');
  };
  const replaced = (name: string, from: string, to: string) => {
    const xml = text(name);
    if (!xml.includes(from)) throw new Error(`Missing generated ${from} in ${name}`);
    return Buffer.from(xml.replace(from, to));
  };
  const replacements = new Map<string, Buffer>();
  for (const [index, slide] of deck.slides.entries()) {
    const name = `ppt/slides/slide${String(index + 1)}.xml`;
    // The slide's background the theme's own (bg1: white on the light deck, black on the dark one), and its words or
    // table after the marker.
    const xml = text(name)
      .replace(
        '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>',
        '<p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg1"/></a:solidFill>',
      )
      .replace(
        '</p:spTree>',
        `${slide.table ? tableXml(slide) : slide.swatches ? swatchesXml(slide) : wordsXml(slide)}</p:spTree>`,
      );
    if (!xml.includes('<a:schemeClr val="bg1"/>')) throw new Error(`Missing generated background on ${name}`);
    replacements.set(name, Buffer.from(xml));
  }
  // Office's own accent 1, or (run 5's tables) all of Office's own theme colours.
  let theme = replaced(
    'ppt/theme/theme1.xml',
    '<a:accent1><a:srgbClr val="3E63DD"/></a:accent1>',
    '<a:accent1><a:srgbClr val="4472C4"/></a:accent1>',
  ).toString('utf8');
  if (deck.office)
    for (const [role, rgb] of Object.entries(OFFICE_COLORS)) {
      const own = new RegExp(`<a:${role}><a:srgbClr val="[0-9A-F]{6}"/></a:${role}>`, 'u');
      if (!own.test(theme)) throw new Error(`Missing generated theme colour ${role}`);
      theme = theme.replace(own, `<a:${role}><a:srgbClr val="${rgb}"/></a:${role}>`);
    }
  replacements.set('ppt/theme/theme1.xml', Buffer.from(theme));
  if (deck.dark)
    replacements.set(
      'ppt/slideMasters/slideMaster1.xml',
      replaced(
        'ppt/slideMasters/slideMaster1.xml',
        'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2"',
        'bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"',
      ),
    );
  replacements.set(
    'ppt/_rels/presentation.xml.rels',
    replaced('ppt/_rels/presentation.xml.rels', '</Relationships>', `${TABLE_STYLES_REL}</Relationships>`),
  );
  replacements.set(
    '[Content_Types].xml',
    replaced('[Content_Types].xml', '</Types>', `${TABLE_STYLES_TYPE}</Types>`),
  );
  // Every part as the base deck has it but those changed, in its order, and the table styles part after them.
  const parts = [...entries].map(([name, data]) => ({
    name,
    data: replacements.get(name) ?? data,
    deflate: true,
  }));
  parts.push({
    name: 'ppt/tableStyles.xml',
    data: Buffer.from(TABLE_STYLES.replace('</a:tblStyleLst>', `${deck.tableStyles ?? ''}</a:tblStyleLst>`)),
    deflate: true,
  });
  await writeFile(source, makeZip(parts));
  return source;
}
