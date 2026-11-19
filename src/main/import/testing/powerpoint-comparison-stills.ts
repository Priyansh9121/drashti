import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readZipEntries } from '../zip';
import { eotOf, fontPanose, sfntFromWoff } from './embedded-font';
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
  table?: {
    rows: number;
    columns: number;
    style?: string;
    bandCol?: boolean;
    every?: boolean;
    /** Run 6: the table's own flags, as given (else run 5's: a header and banded rows, `bandCol`, `every`). */
    flags?: readonly TableFlag[];
  };
  /** Run 6: several boxes of words, each its own (X20's first lines). */
  boxes?: readonly StillsBox[];
  /** Run 6: several small tables, each its own (every one of PowerPoint's style IDs). */
  tables?: readonly StillsTable[];
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
  /** Run 6: fonts embedded in the deck, as PowerPoint embeds them (its embeddedFontLst): each from a WOFF Drashti ships. */
  fonts?: readonly StillsFont[];
}

/** A table's flags, as tblPr writes them (in its schema's order). */
export type TableFlag = 'firstRow' | 'firstCol' | 'lastRow' | 'lastCol' | 'bandRow' | 'bandCol';
const FLAG_ORDER: readonly TableFlag[] = ['firstRow', 'firstCol', 'lastRow', 'lastCol', 'bandRow', 'bandCol'];
/** One of several tables on a slide: its place, its rows and columns, its style by ID alone, its flags. */
export interface StillsTable {
  box: { x: number; y: number; w: number; h: number };
  rows: number;
  columns: number;
  style: string;
  flags: readonly TableFlag[];
  /** Its words' size, hundredths of a point. */
  size: number;
}
/** One of several boxes of words on a slide (run 6's first lines). */
export interface StillsBox {
  box: { x: number; y: number; w: number; h: number };
  paragraphs: StillsParagraph[];
  /** Its words' size, hundredths of a point. */
  size: number;
  font: string;
  anchor?: 't' | 'ctr' | 'b';
  /** Each paragraph's line spacing, a percentage of a line (lnSpc spcPct). */
  lineSpacing?: number;
  /** Each paragraph's line spacing fixed in points (lnSpc spcPts, hundredths of a point). */
  lineSpacingPoints?: number;
  fit?: { fontScale: number; lnSpcReduction?: number };
}
/** A font embedded in a deck: its typeface (as runs name it) and the WOFF it comes from (a package's own file). */
export interface StillsFont {
  typeface: string;
  woff: string;
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
  `<a:r><a:rPr lang="${/[\u0A80-\u0AFF]/u.test(text) ? 'gu-IN' : /[\u0900-\u097F]/u.test(text) ? 'hi-IN' : 'en-US'}" sz="${String(size)}" dirty="0">${themeText ? '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>' : ''}<a:latin typeface="${esc(font)}"/><a:cs typeface="${esc(font)}"/></a:rPr><a:t>${esc(text)}</a:t></a:r>`;
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

interface TableFrame {
  box: StillsSlide['box'];
  rows: number;
  columns: number;
  style: string;
  /** tblPr's attributes, as written. */
  flags: string;
  size: number;
  words: (row: number, column: number) => string;
}
function tableFrameXml(table: TableFrame, id: number, name: string): string {
  const { rows, columns } = table;
  const width = Math.round(table.box.w / columns);
  const height = Math.round(table.box.h / rows);
  const cell = (r: number, c: number) =>
    `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${runXml(table.words(r, c), table.size, false)}</a:p></a:txBody><a:tcPr/></a:tc>`;
  const body = Array.from(
    { length: rows },
    (_, r) =>
      `<a:tr h="${String(height)}">${Array.from({ length: columns }, (__, c) => cell(r, c)).join('')}</a:tr>`,
  ).join('');
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${String(id)}" name="${esc(name)}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>${xfrm(table.box, 'p:xfrm')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr${table.flags ? ` ${table.flags}` : ''}><a:tableStyleId>${table.style}</a:tableStyleId></a:tblPr><a:tblGrid>${`<a:gridCol w="${String(width)}"/>`.repeat(columns)}</a:tblGrid>${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}
const flagsXml = (flags: readonly TableFlag[]) =>
  FLAG_ORDER.filter((flag) => flags.includes(flag))
    .map((flag) => `${flag}="1"`)
    .join(' ');

function tableXml(slide: StillsSlide): string {
  const table = slide.table ?? { rows: 0, columns: 0 };
  return tableFrameXml(
    {
      box: slide.box,
      rows: table.rows,
      columns: table.columns,
      style: table.style ?? DEFAULT_TABLE_STYLE,
      flags: table.flags
        ? flagsXml(table.flags)
        : table.every
          ? 'firstRow="1" firstCol="1" lastRow="1" lastCol="1" bandRow="1"'
          : `firstRow="1" bandRow="1"${table.bandCol ? ' bandCol="1"' : ''}`,
      size: 1800,
      words: (r, c) => (r === 0 ? `Heading ${String(c + 1)}` : `Cell ${String(r)}.${String(c + 1)}`),
    },
    4,
    'Placeholder table',
  );
}

/** Run 6: several small tables on a slide, each its own style. */
function tablesXml(slide: StillsSlide): string {
  return (slide.tables ?? [])
    .map((table, i) =>
      tableFrameXml(
        {
          ...table,
          flags: flagsXml(table.flags),
          words: (r, c) => (r === 0 ? `H${String(c + 1)}` : `${String.fromCharCode(64 + r)}${String(c + 1)}`),
        },
        100 + i,
        `Placeholder table ${String(i + 1)}`,
      ),
    )
    .join('');
}

/** Run 6: several boxes of words on a slide, each its own font, size, line spacing, shrink and anchor. */
function boxesXml(slide: StillsSlide): string {
  return (slide.boxes ?? [])
    .map((box, i) => {
      const lineSpacing =
        box.lineSpacingPoints !== undefined
          ? `<a:lnSpc><a:spcPts val="${String(box.lineSpacingPoints)}"/></a:lnSpc>`
          : box.lineSpacing === undefined
            ? ''
            : `<a:lnSpc><a:spcPct val="${String(box.lineSpacing * 1000)}"/></a:lnSpc>`;
      const paragraphs = box.paragraphs
        .map(
          (p) =>
            `<a:p><a:pPr>${lineSpacing}<a:buNone/></a:pPr>${runXml(p.text, box.size, true, box.font)}</a:p>`,
        )
        .join('');
      const fit = box.fit
        ? `<a:normAutofit fontScale="${String(box.fit.fontScale)}"${box.fit.lnSpcReduction ? ` lnSpcReduction="${String(box.fit.lnSpcReduction)}"` : ''}/>`
        : '<a:noAutofit/>';
      return `<p:sp><p:nvSpPr><p:cNvPr id="${String(20 + i)}" name="Placeholder words ${String(i + 1)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(box.box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="${box.anchor ?? 't'}">${fit}</a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
    })
    .join('');
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

/*
 * Run 6 (h-run6, Session 59): what real PowerPoint is asked next (prompt 05).
 * - X16, tables: PowerPoint's table style families beyond Medium Style 2 and the plain ones, by their IDs alone, each
 *   with every part on (first and last row and column, rows and columns banded: the cells where the bands meet, which
 *   run 5 read without them) and with both bands alone; and every one of PowerPoint's 74 style IDs in a small table of
 *   its own (the two published typos corrected), so that PowerPoint's saved copy of the deck writes each style's
 *   definition as PowerPoint has it, and its PDF shows each drawn.
 * - X20, first lines: where PowerPoint puts a box's first line (run 5's baselines fitted no one rule): four boxes a
 *   slide (18, 28, 40 and 66 pt), two lines each, under single spacing, percentages, exact spacings and PowerPoint's
 *   shrink, in Arial, PowerPoint's own Calibri, Times New Roman and Verdana (fonts whose heights split differently above
 *   and below their baselines), a middle and a bottom anchor in Arial, and Drashti's bundled Noto Sans, Noto Sans
 *   Gujarati and Noto Sans Devanagari, embedded in their own deck (nothing installed on the computer).
 */
/** PowerPoint's 74 built-in table styles, by name and ID (LibreOffice's list, MPL-2.0; the IDs only). */
const FAMILY_IDS: readonly [string, readonly string[]][] = [
  [
    'Themed Style 1',
    [
      '3C2FFA5D-87B4-456A-9821-1D502468CF0F',
      '284E427A-3D55-4303-BF80-6455036E1DE7',
      '69C7853C-536D-4A76-A0AE-DD22124D55A5',
      '775DCB02-9BB8-47FD-8907-85C794F793BA',
      '35758FB7-9AC5-4552-8A53-C91805E547FA',
      '08FB837D-C827-4EFA-A057-4D05807E0F7C',
    ],
  ],
  [
    'Themed Style 2',
    [
      'D113A9D2-9D6B-4929-AA2D-F23B5EE8CBE7',
      '18603FDC-E32A-4AB5-989C-0864C3EAD2B8',
      '306799F8-075E-4A3A-A7F6-7FBC6576F1A4',
      'E269D01E-BC32-4049-B463-5C60D7B0CCD2',
      '327F97BB-C833-4FB7-BDE5-3F7075034690',
      '638B1855-1B75-4FBE-930C-398BA8C253C6',
    ],
  ],
  [
    'Light Style 1',
    [
      '9D7B26C5-4107-4FEC-AEDC-1716B250A1EF',
      '3B4B98B0-60AC-42C2-AFA5-B58CD77FA1E5',
      '0E3FDE45-AF77-4B5C-9715-49D594BDF05E',
      'C083E6E3-FA7D-4D7B-A595-EF9225AFEA82',
      'D27102A9-8310-4765-A935-A1911B00CA55',
      '5FD0F851-EC5A-4D38-B0AD-8093EC10F338',
      '68D230F3-CF80-4859-8CE7-A43EE81993B5',
    ],
  ],
  [
    'Light Style 2',
    [
      '7E9639D4-E3E2-4D34-9284-5A2195B3D0D7',
      '69012ECD-51FC-41F1-AA8D-1B2483CD663E',
      '72833802-FEF1-4C79-8D5D-14CF1EAF98D9',
      'F2DE63D5-997A-4646-A377-4702673A728D',
      '17292A2E-F333-43FB-9621-5CBBE7FDCDCB',
      '5A111915-BE36-4E01-A7E5-04B1672EAD32',
      '912C8C85-51F0-491E-9774-3900AFEF0FD7',
    ],
  ],
  [
    'Light Style 3',
    [
      '616DA210-FB5B-4158-B5E0-FEB733F419BA',
      'BC89EF96-8CEA-46FF-86C4-4CE0E7609802',
      '5DA37D80-6434-44D0-A028-1B22A696006F',
      '8799B23B-EC83-4686-B30A-512413B5E67A',
      'ED083AE6-46FA-4A59-8FB0-9F97EB10719F',
      'BDBED569-4797-4DF1-A0F4-6AAB3CD982D8',
      'E8B1032C-EA38-4F05-BA0D-38AFFFC7BED3',
    ],
  ],
  [
    'Medium Style 1',
    [
      '793D81CF-94F2-401A-BA57-92F5A7B2D0C5',
      'B301B821-A1FF-4177-AEE7-76D212191A09',
      '9DCAF9ED-07DC-4A11-8D7F-57B35C25682E',
      '1FECB4D8-DB02-4DC6-A0A2-4F2EBAE1DC90',
      '1E171933-4619-4E11-9A3F-F7608DF75F80',
      'FABFCF23-3B69-468F-B69F-88F6DE6A72F2',
      '10A1B5D5-9B99-4C35-A422-299274C87663',
    ],
  ],
  [
    'Medium Style 2',
    [
      '073A0DAA-6AF3-43AB-8588-CEC1D06C72B9',
      '5C22544A-7EE6-4342-B048-85BDC9FD1C3A',
      '21E4AEA4-8DFA-4A89-87EB-49C32662AFE0',
      'F5AB1C69-6EDB-4FF4-983F-18BD219EF322',
      '00A15C55-8517-42AA-B614-E9B94910E393',
      '7DF18680-E054-41AD-8BC1-D1AEF772440D',
      '93296810-A885-4BE3-A3E7-6D5BEEA58F35',
    ],
  ],
  [
    'Medium Style 3',
    [
      '8EC20E35-A176-4012-BC5E-935CFFF8708E',
      '6E25E649-3F16-4E02-A733-19D2CDBF48F0',
      '85BE263C-DBD7-4A20-BB59-AAB30ACAA65A',
      'EB344D84-9AFB-497E-A393-DC336BA19D2E',
      'EB9631B5-78F2-41C9-869B-9F39066F8104',
      '74C1A8A3-306A-4EB7-A6B1-4F7E0EB9C5D6',
      '2A488322-F2BA-4B5B-9748-0D474271808F',
    ],
  ],
  [
    'Medium Style 4',
    [
      'D7AC3CCA-C797-4891-BE02-D94E43425B78',
      '69CF1AB2-1976-4502-BF36-3FF5EA218861',
      '8A107856-5554-42FB-B03E-39F5DBC370BA',
      '0505E3EF-67EA-436B-97B2-0124C06EBD24',
      'C4B1156A-380E-4F78-BDF5-A606A8083BF9',
      '22838BEF-8BB2-4498-84A7-C5851F593DF1',
      '16D9F66E-5EB9-4882-86FB-DCBF35E3C3E4',
    ],
  ],
  [
    'Dark Style 1',
    [
      'E8034E78-7F5D-4C2E-B375-FC64B27BC917',
      '125E5076-3810-47DD-B79F-674D7AD40C01',
      '37CE84F3-28C3-443E-9E96-99CF82512B78',
      'D03447BB-5D67-496B-8E87-E561075AD55C',
      'E929F9F4-4A8F-4326-A1B4-22849713DDAB',
      '8FD4443E-F989-4FC4-A0C8-D5A2AF1F390B',
      'AF606853-7671-496A-8E4F-DF71F8EC918B',
    ],
  ],
];
export const POWERPOINT_TABLE_STYLES: readonly { name: string; id: string }[] = [
  { name: 'No Style, No Grid', id: '{2D5ABB26-0587-4C30-8999-92F81FD0307C}' },
  { name: 'No Style, Table Grid', id: '{5940675A-B579-460E-94D1-54222C63F5DA}' },
  ...FAMILY_IDS.flatMap(([family, ids]) =>
    ids.map((id, i) => ({
      // Themed styles have no plain one: their first is accent 1.
      name: family.startsWith('Themed')
        ? `${family} - Accent ${String(i + 1)}`
        : i === 0
          ? family
          : `${family} - Accent ${String(i)}`,
      id: `{${id}}`,
    })),
  ),
  { name: 'Dark Style 2', id: '{5202B0CA-FC54-4496-8BCA-5EF66A818D29}' },
  { name: 'Dark Style 2 - Accent 1/Accent 2', id: '{0660B408-B3CF-4A94-85FC-2B1E0A45F4A2}' },
  { name: 'Dark Style 2 - Accent 3/Accent 4', id: '{91EBBBCC-DAD2-459C-BE2E-F6DE35CF9A28}' },
  { name: 'Dark Style 2 - Accent 5/Accent 6', id: '{46F890A9-2807-4EBB-B81D-B2AA78EC7F39}' },
];
const styleId = (name: string): string => {
  const found = POWERPOINT_TABLE_STYLES.find((style) => style.name === name);
  if (!found) throw new Error(`No table style ${name}`);
  return found.id;
};
/** Run 5's twenty, the two published typos corrected (Light Style 1's real ID). */
const RUN6_FAMILIES = [
  'Themed Style 1 - Accent 1',
  'Themed Style 1 - Accent 2',
  'Themed Style 2 - Accent 1',
  'Themed Style 2 - Accent 6',
  'Light Style 1',
  'Light Style 1 - Accent 1',
  'Light Style 2 - Accent 1',
  'Light Style 2 - Accent 2',
  'Light Style 3',
  'Light Style 3 - Accent 1',
  'Medium Style 1 - Accent 1',
  'Medium Style 1 - Accent 2',
  'Medium Style 3 - Accent 1',
  'Medium Style 3 - Accent 2',
  'Medium Style 4 - Accent 1',
  'Medium Style 4 - Accent 6',
  'Dark Style 1 - Accent 1',
  'Dark Style 1 - Accent 2',
  'Dark Style 2',
  'Dark Style 2 - Accent 1/Accent 2',
];
/** Six rows and five columns: with every part on, rows 1-4 and columns 1-3 inside, where each band meets the others. */
const RUN6_TABLE = { rows: 6, columns: 5 };
const EVERY_FLAG: readonly TableFlag[] = ['firstRow', 'firstCol', 'lastRow', 'lastCol', 'bandRow', 'bandCol'];
/** Twelve small tables a slide (4 across, 3 down), each 4 rows and 3 columns, PowerPoint's flags for a new table. */
const SMALL = {
  w: 3.0 * INCH,
  h: 2.0 * INCH,
  x: 0.45 * INCH,
  y: 0.85 * INCH,
  dx: 3.13 * INCH,
  dy: 2.18 * INCH,
};
const smallTables = (): Omit<StillsSlide, 'marker'>[] => {
  const slides: Omit<StillsSlide, 'marker'>[] = [];
  for (let from = 0; from < POWERPOINT_TABLE_STYLES.length; from += 12) {
    const styles = POWERPOINT_TABLE_STYLES.slice(from, from + 12);
    slides.push({
      name: `IDs · ${String(from + 1)}-${String(from + styles.length)}`,
      box: TABLE_BOX,
      tables: styles.map((style, i) => ({
        box: {
          x: SMALL.x + (i % 4) * SMALL.dx,
          y: SMALL.y + Math.floor(i / 4) * SMALL.dy,
          w: SMALL.w,
          h: SMALL.h,
        },
        rows: 4,
        columns: 3,
        style: style.id,
        flags: ['firstRow', 'bandRow'],
        size: 1000,
      })),
    });
  }
  return slides;
};

/** Run 6's tables, for X16. */
export const STILLS_RUN6_TABLES: StillsDeck = {
  file: 'Placeholder PowerPoint run6 tables.pptx',
  dark: false,
  office: true,
  slides: marked([
    ...smallTables(),
    ...RUN6_FAMILIES.map((style) => ({
      name: `Table · ${style}, every part on`,
      box: TABLE_BOX,
      table: { ...RUN6_TABLE, style: styleId(style), flags: EVERY_FLAG },
    })),
    ...RUN6_FAMILIES.map((style) => ({
      name: `Table · ${style}, rows and columns banded`,
      box: TABLE_BOX,
      table: { ...RUN6_TABLE, style: styleId(style), flags: ['bandRow', 'bandCol'] as const },
    })),
  ]),
};

/** The first lines' sizes (points): four boxes a slide. */
export const RUN6_LINE_SIZES = [18, 28, 40, 66] as const;
/** Each box's width (inches), wide enough for its two lines at its size in the widest font (Verdana). */
const LINE_WIDTHS = [1.6, 2.0, 2.8, 4.2];
const LINE_GAP = 0.45;
const LINE_LEFT = (13.333_333 - LINE_WIDTHS.reduce((a, b) => a + b, 0) - 3 * LINE_GAP) / 2;
const LINE_TOP = 1.0 * INCH;
/** Tall enough for two lines at 200% of 66 pt, so that no box's words run past its bottom. */
const LINE_HEIGHT = 6.2 * INCH;
/** A line spacing of run 6: single (none written), a percentage, a multiple of the size in points, or a shrink. */
export interface Run6Spacing {
  label: string;
  lineSpacing?: number;
  /** Exactly this many times the words' size, in points. */
  exact?: number;
  fit?: { fontScale: number; lnSpcReduction?: number };
}
export const RUN6_SPACINGS: readonly Run6Spacing[] = [
  { label: 'single' },
  { label: 'lines 100%', lineSpacing: 100 },
  { label: 'lines 80%', lineSpacing: 80 },
  { label: 'lines 90%', lineSpacing: 90 },
  { label: 'lines 120%', lineSpacing: 120 },
  { label: 'lines 150%', lineSpacing: 150 },
  { label: 'lines 200%', lineSpacing: 200 },
  { label: 'exactly 1.0 x size', exact: 1.0 },
  { label: 'exactly 1.2 x size', exact: 1.2 },
  { label: 'exactly 1.5 x size', exact: 1.5 },
  { label: 'shrunk 62.5%, 20% less', fit: { fontScale: 62_500, lnSpcReduction: 20_000 } },
  { label: 'shrunk 77.5%, 10% less', fit: { fontScale: 77_500, lnSpcReduction: 10_000 } },
  { label: 'shrunk 90%', fit: { fontScale: 90_000 } },
];
/** The words of a script, two lines: none hangs below its line in Latin; the Indian ones are the placeholder word. */
const LINE_WORDS: Record<string, readonly [string, string]> = {
  latin: ['Line A', 'Line B'],
  gujarati: ['નમૂના', 'નમૂના'],
  devanagari: ['नमूना', 'नमूना'],
};
/** A slide of four boxes, one font and one spacing (and an anchor: the box's own height then 4.5 in). */
function lineSlide(
  name: string,
  font: string,
  spacing: Run6Spacing,
  script: keyof typeof LINE_WORDS = 'latin',
  anchor?: 'ctr' | 'b',
): Omit<StillsSlide, 'marker'> {
  let x = LINE_LEFT * INCH;
  const boxes = RUN6_LINE_SIZES.map((points, i): StillsBox => {
    const w = (LINE_WIDTHS[i] ?? 2) * INCH;
    const at = x;
    x += w + LINE_GAP * INCH;
    const [first, second] = LINE_WORDS[script] ?? ['Line A', 'Line B'];
    const paragraphs = [{ text: first }, { text: second }];
    let h = anchor ? 4.5 * INCH : LINE_HEIGHT;
    if (spacing.fit) {
      // As tall as its two lines take at PowerPoint's shrink (each line 1.2 x the shrunk size, rounded to a point),
      // a fiftieth more, so that PowerPoint keeps the shrink the deck saves (as PF-4b's boxes).
      const shrunk = Math.round((points * spacing.fit.fontScale) / 100_000);
      const cut = (spacing.fit.lnSpcReduction ?? 0) / 1000;
      h = Math.round((2 * 1.2 * shrunk * ((100 - cut) / 100) + 7.2) * 1.02 * POINT);
    }
    return {
      box: { x: at, y: LINE_TOP, w, h },
      paragraphs,
      size: points * 100,
      font,
      ...(anchor ? { anchor } : {}),
      ...(spacing.lineSpacing === undefined ? {} : { lineSpacing: spacing.lineSpacing }),
      ...(spacing.exact === undefined ? {} : { lineSpacingPoints: Math.round(spacing.exact * points * 100) }),
      ...(spacing.fit ? { fit: spacing.fit } : {}),
    };
  });
  return { name, box: WORDS_BOX, boxes };
}
const fontSlides = (font: string, script: keyof typeof LINE_WORDS = 'latin') =>
  RUN6_SPACINGS.map((spacing) => lineSlide(`${font} · ${spacing.label}`, font, spacing, script));
const SPACING = (label: string): Run6Spacing => {
  const found = RUN6_SPACINGS.find((spacing) => spacing.label === label);
  if (!found) throw new Error(`No spacing ${label}`);
  return found;
};

/** Run 6's first lines in the fonts PowerPoint has of its own (and Windows has): for X20. */
export const STILLS_RUN6_LINES: StillsDeck = {
  file: 'Placeholder PowerPoint run6 lines.pptx',
  dark: false,
  slides: marked([
    ...['Arial', 'Calibri', 'Times New Roman', 'Verdana'].flatMap((font) => fontSlides(font)),
    ...(['ctr', 'b'] as const).flatMap((anchor) =>
      ['single', 'lines 150%', 'lines 80%'].map((label) =>
        lineSlide(
          `Arial anchored ${anchor === 'ctr' ? 'middle' : 'bottom'} · ${label}`,
          'Arial',
          SPACING(label),
          'latin',
          anchor,
        ),
      ),
    ),
  ]),
};

/** Run 6's first lines in Drashti's bundled fonts, embedded in the deck (PowerPoint has none of them): for X20. */
export const STILLS_RUN6_NOTO: StillsDeck = {
  file: 'Placeholder PowerPoint run6 noto.pptx',
  dark: false,
  fonts: [
    { typeface: 'Noto Sans', woff: '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff' },
    {
      typeface: 'Noto Sans Gujarati',
      woff: '@fontsource/noto-sans-gujarati/files/noto-sans-gujarati-gujarati-400-normal.woff',
    },
    {
      typeface: 'Noto Sans Devanagari',
      woff: '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff',
    },
  ],
  slides: marked([
    ...fontSlides('Noto Sans'),
    ...fontSlides('Noto Sans Gujarati', 'gujarati'),
    ...fontSlides('Noto Sans Devanagari', 'devanagari'),
  ]),
};

const FONT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font';
const require = createRequire(import.meta.url);

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
        `${slide.table ? tableXml(slide) : slide.tables ? tablesXml(slide) : slide.boxes ? boxesXml(slide) : slide.swatches ? swatchesXml(slide) : wordsXml(slide)}</p:spTree>`,
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
  // Run 6: fonts embedded as PowerPoint embeds them (Embedded OpenType parts, named in presentation.xml).
  const fonts = await Promise.all(
    (deck.fonts ?? []).map(async (font, i) => {
      const sfnt = sfntFromWoff(await readFile(require.resolve(font.woff)));
      return { ...font, id: `rId${String(4 + i)}`, part: `ppt/fonts/font${String(i + 1)}.fntdata`, sfnt };
    }),
  );
  const fontRels = fonts
    .map((f) => `<Relationship Id="${f.id}" Type="${FONT_REL}" Target="${f.part.slice(4)}"/>`)
    .join('');
  replacements.set(
    'ppt/_rels/presentation.xml.rels',
    replaced(
      'ppt/_rels/presentation.xml.rels',
      '</Relationships>',
      `${TABLE_STYLES_REL}${fontRels}</Relationships>`,
    ),
  );
  replacements.set(
    '[Content_Types].xml',
    replaced(
      '[Content_Types].xml',
      '</Types>',
      `${fonts.length ? '<Default Extension="fntdata" ContentType="application/x-fontdata"/>' : ''}${TABLE_STYLES_TYPE}</Types>`,
    ),
  );
  if (fonts.length) {
    const list = fonts
      .map(
        (f) =>
          `<p:embeddedFont><p:font typeface="${esc(f.typeface)}" panose="${fontPanose(f.sfnt)}" pitchFamily="34" charset="0"/><p:regular r:id="${f.id}"/></p:embeddedFont>`,
      )
      .join('');
    const presentation = replaced(
      'ppt/presentation.xml',
      '<p:notesSz cx="6858000" cy="9144000"/>',
      `<p:notesSz cx="6858000" cy="9144000"/><p:embeddedFontLst>${list}</p:embeddedFontLst>`,
    ).toString('utf8');
    if (!presentation.includes('<p:presentation ')) throw new Error('Missing generated presentation');
    replacements.set(
      'ppt/presentation.xml',
      Buffer.from(presentation.replace('<p:presentation ', '<p:presentation embedTrueTypeFonts="1" ')),
    );
  }
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
  for (const f of fonts) parts.push({ name: f.part, data: eotOf(f.sfnt), deflate: true });
  await writeFile(source, makeZip(parts));
  return source;
}
