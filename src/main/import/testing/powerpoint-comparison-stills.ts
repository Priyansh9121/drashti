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
  /** A table of placeholder words in PowerPoint's default style, its first row a header and its rows banded. */
  table?: { rows: number; columns: number };
}
export interface StillsDeck {
  file: string;
  /** The master's colour map turned round (bg1 = dk1, tx1 = lt1, ...), as a dark theme has it. */
  dark: boolean;
  slides: readonly StillsSlide[];
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

const esc = (text: string) => text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
const spaceXml = (tag: 'spcBef' | 'spcAft', space: StillsSpace | undefined) =>
  space === undefined
    ? ''
    : `<a:${tag}>${'pct' in space ? `<a:spcPct val="${String(space.pct)}"/>` : `<a:spcPts val="${String(space.pts)}"/>`}</a:${tag}>`;
/** A run of words: in the theme's text colour (tx1, which the dark deck's colour map turns white), or the table style's. */
const runXml = (text: string, size: number, themeText = true) =>
  `<a:r><a:rPr lang="en-US" sz="${String(size)}" dirty="0">${themeText ? '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>' : ''}<a:latin typeface="Arial"/></a:rPr><a:t>${esc(text)}</a:t></a:r>`;
const xfrm = (box: StillsSlide['box'], tag = 'a:xfrm') =>
  `<${tag}><a:off x="${String(Math.round(box.x))}" y="${String(Math.round(box.y))}"/><a:ext cx="${String(Math.round(box.w))}" cy="${String(Math.round(box.h))}"/></${tag}>`;

function wordsXml(slide: StillsSlide): string {
  const paragraphs = (slide.paragraphs ?? [])
    .map(
      (p) =>
        `<a:p><a:pPr>${spaceXml('spcBef', p.before)}${spaceXml('spcAft', p.after)}<a:buNone/></a:pPr>${runXml(p.text, 4000)}</a:p>`,
    )
    .join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Placeholder words"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(slide.box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="${slide.anchor ?? 't'}"${slide.firstLastPara ? ' spcFirstLastPara="1"' : ''}><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
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
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Placeholder table"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>${xfrm(slide.box, 'p:xfrm')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>${DEFAULT_TABLE_STYLE}</a:tableStyleId></a:tblPr><a:tblGrid>${`<a:gridCol w="${String(width)}"/>`.repeat(columns)}</a:tblGrid>${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
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
      .replace('</p:spTree>', `${slide.table ? tableXml(slide) : wordsXml(slide)}</p:spTree>`);
    if (!xml.includes('<a:schemeClr val="bg1"/>')) throw new Error(`Missing generated background on ${name}`);
    replacements.set(name, Buffer.from(xml));
  }
  // Office's own accent 1.
  replacements.set(
    'ppt/theme/theme1.xml',
    replaced(
      'ppt/theme/theme1.xml',
      '<a:accent1><a:srgbClr val="3E63DD"/></a:accent1>',
      '<a:accent1><a:srgbClr val="4472C4"/></a:accent1>',
    ),
  );
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
  parts.push({ name: 'ppt/tableStyles.xml', data: Buffer.from(TABLE_STYLES), deflate: true });
  await writeFile(source, makeZip(parts));
  return source;
}
