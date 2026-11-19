import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SlideElement, TextElement } from '../../../shared/model';
import { editablePptxFixture, slideXml } from '../testing/editable-pptx-fixture';
import { POWERPOINT_RUN6_TABLES, type PowerPointTable } from '../testing/powerpoint-run6-tables';
import { readEditablePptx } from './editable-pptx';

/*
 * X16 (h-x16fam, Session 59): PowerPoint's built-in table styles drawn as real PowerPoint draws them. Each table of
 * real-PowerPoint run 6 (testing/powerpoint-run6-tables.ts: its PDF of all 74 built-in style IDs, and each of the 20
 * families with every part on and with banded rows and columns alone) is rebuilt in a deck of the same theme that saves
 * no style definitions (as python-pptx and other exporters write one, and as PowerPoint itself keeps one it did not
 * style), read, and measured as the PDF was: each cell's fill where its words are not, its words' colour and boldness,
 * and the line over the middle of each side of each cell, double lines too. Within a level of colour and 0.05 pt.
 */

const COLORS = [
  ['dk1', '000000'],
  ['lt1', 'FFFFFF'],
  ['dk2', '44546A'],
  ['lt2', 'E7E6E6'],
  ['accent1', '4472C4'],
  ['accent2', 'ED7D31'],
  ['accent3', 'A5A5A5'],
  ['accent4', 'FFC000'],
  ['accent5', '5B9BD5'],
  ['accent6', '70AD47'],
] as const;
const SOLID = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
/** Run 6's theme: Office's colours over solid fill styles, and lines of 0.5, 1 and 1.5 pt (Office's own widths). */
const THEME =
  '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Placeholder"><a:themeElements>' +
  '<a:clrScheme name="Placeholder">' +
  COLORS.map(([name, value]) => `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`).join('') +
  '</a:clrScheme><a:fontScheme name="Placeholder"><a:majorFont><a:latin typeface="Arial"/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="Placeholder">' +
  `<a:fillStyleLst>${SOLID.repeat(3)}</a:fillStyleLst><a:lnStyleLst>` +
  [6350, 12_700, 19_050].map((w) => `<a:ln w="${String(w)}">${SOLID}</a:ln>`).join('') +
  `</a:lnStyleLst><a:bgFillStyleLst>${SOLID.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
/** A table style list naming PowerPoint's default and holding no definitions. */
const NO_DEFINITIONS =
  '<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>';

/** Each table at the same place: 1.5 in columns and 0.5 in rows (144 x 48 slide px), an inch in from the corner. */
const EMU_PX = 9525;
const LEFT = 914_400;
const TOP = 914_400;
const COLUMN = 1_371_600;
const ROW = 457_200;
const PX_PT = 4 / 3;

function tableXml(table: PowerPointTable): string {
  const flags = table.flags.map((name) => `${name}="1"`).join(' ');
  const cell =
    '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1000"/><a:t>Ab</a:t></a:r></a:p>' +
    '</a:txBody><a:tcPr/></a:tc>';
  return (
    '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="7" name="Placeholder table"/></p:nvGraphicFramePr>' +
    `<p:xfrm><a:off x="${String(LEFT)}" y="${String(TOP)}"/>` +
    `<a:ext cx="${String(COLUMN * table.columns)}" cy="${String(ROW * table.rows)}"/></p:xfrm>` +
    `<a:graphic><a:graphicData><a:tbl><a:tblPr ${flags}><a:tableStyleId>${table.style}</a:tableStyleId></a:tblPr>` +
    `<a:tblGrid>${`<a:gridCol w="${String(COLUMN)}"/>`.repeat(table.columns)}</a:tblGrid>` +
    `<a:tr h="${String(ROW)}">${cell.repeat(table.columns)}</a:tr>`.repeat(table.rows) +
    '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>'
  );
}

/** A measure's rows (or boundaries), each item written once with how many of it ("4472c4*5"). */
function expand(text: string): string[][] {
  return text.split(' / ').map((row) =>
    row.split(' ').flatMap((item) => {
      const [value = '', times = '1'] = item.split('*');
      return Array.from({ length: Number(times) }, () => value);
    }),
  );
}

const rgb = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const near = (a: number[], b: number[]) => a.every((value, i) => Math.abs(value - (b[i] ?? Number.NaN)) <= 1);
const hexOf = (values: number[]) =>
  values.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('');

/** What Drashti shows at a point (slide px): its fills there in order, each over the one under it, over white. */
function shows(elements: SlideElement[], x: number, y: number): number[] {
  let seen = [255, 255, 255];
  for (const el of elements) {
    if (el.kind !== 'shape' || el.shape === 'line' || !el.fill) continue;
    const { frame } = el;
    if (x < frame.x || x > frame.x + frame.width || y < frame.y || y > frame.y + frame.height) continue;
    const share = (el.fill.length === 9 ? parseInt(el.fill.slice(7, 9), 16) / 255 : 1) * el.opacity;
    const color = rgb(el.fill);
    seen = seen.map((under, i) => share * (color[i] ?? 0) + (1 - share) * under);
  }
  return seen;
}

interface Drawn {
  /** From the grid's line to the drawn line's middle, px (down or right). */
  offset: number;
  /** Points. */
  width: number;
  color: string;
}

/** Drashti's lines over a point of the grid (px) along it, within 4 px of it: a line's frame is its run laid flat. */
function linesAt(elements: SlideElement[], x: number, y: number, vertical: boolean): Drawn[] {
  return elements.flatMap((el) => {
    if (el.kind !== 'shape' || el.shape !== 'line' || !el.outline) return [];
    const turn = (((el.rotation ?? 0) % 180) + 180) % 180;
    if (vertical ? Math.abs(turn - 90) >= 1 : turn >= 1 && turn <= 179) return [];
    const middleX = el.frame.x + el.frame.width / 2;
    const middleY = el.frame.y + el.frame.height / 2;
    const offset = vertical ? middleX - x : middleY - y;
    const along = Math.abs(vertical ? y - middleY : x - middleX) <= el.frame.width / 2;
    return Math.abs(offset) <= 4 && along
      ? [{ offset, width: el.outline.width / PX_PT, color: el.outline.color }]
      : [];
  });
}

/** A line Drashti drew, as the measures are written (its offset from the grid, if any, in px). */
function drawnLine({ color, width, offset }: Drawn): string {
  const off = Math.abs(offset) > 0.05 ? `${offset > 0 ? '+' : ''}${offset.toFixed(1)}px` : '';
  return `${color.slice(1)}@${String(Math.round(width * 100) / 100)}${off}`;
}

/** A side as PowerPoint drew it ("colour@pt", "=colour@pt" a double line, "-" none) against Drashti's lines there. */
function sideDiffers(want: string, drawn: Drawn[]): string | null {
  const said = drawn.length ? drawn.map(drawnLine).join(' ') : '-';
  if (want === '-') return drawn.length === 0 ? null : `- vs ${said}`;
  const double = want.startsWith('=');
  const [color = '', points = ''] = want.replace('=', '').split('@');
  const width = Number(points);
  // A double line: two strokes a third of its width each, their middles a third of its width either side of the grid.
  const wanted = double
    ? [-1, 1].map((side) => ({ offset: (side * width * PX_PT) / 3, width: width / 3 }))
    : [{ offset: 0, width }];
  const same =
    drawn.length === wanted.length &&
    wanted.every((line) =>
      drawn.some(
        (d) =>
          Math.abs(d.offset - line.offset) <= 0.5 &&
          Math.abs(d.width - line.width) <= 0.05 &&
          near(rgb(d.color), rgb(`#${color}`)),
      ),
    );
  return same ? null : `${want} vs ${said}`;
}

/** Everywhere Drashti's reading of one table differs from PowerPoint's drawing of it. */
function differences(table: PowerPointTable, elements: SlideElement[]): string[] {
  const differs: string[] = [];
  const x0 = LEFT / EMU_PX;
  const y0 = TOP / EMU_PX;
  const w = COLUMN / EMU_PX;
  const h = ROW / EMU_PX;
  const fills = expand(table.fills);
  const words = expand(table.words);
  for (let r = 0; r < table.rows; r++)
    for (let c = 0; c < table.columns; c++) {
      const want = fills[r]?.[c] ?? '';
      const seen = shows(elements, x0 + (c + 0.75) * w, y0 + (r + 0.62) * h);
      if (!near(seen, rgb(`#${want}`)))
        differs.push(`r${String(r)}c${String(c)} fill ${want} vs ${hexOf(seen)}`);
      const text = elements.find(
        (el): el is TextElement => el.kind === 'text' && el.tableCell?.row === r && el.tableCell.column === c,
      );
      const run = text?.runs?.find((piece) => piece.text.trim() !== '');
      const color = run?.color ?? text?.style.color ?? '';
      const bold = (run?.weight ?? text?.style.fontWeight ?? 400) >= 600;
      const wantWords = words[r]?.[c] ?? '';
      const wantBold = wantWords.endsWith('!');
      const wantColor = wantWords.replace('!', '');
      if (!near(rgb(color), rgb(`#${wantColor}`)) || bold !== wantBold)
        differs.push(`r${String(r)}c${String(c)} words ${wantWords} vs ${color.slice(1)}${bold ? '!' : ''}`);
    }
  expand(table.across).forEach((boundary, r) => {
    boundary.forEach((want, c) => {
      const found = sideDiffers(want, linesAt(elements, x0 + (c + 0.5) * w, y0 + r * h, false));
      if (found) differs.push(`h${String(r)}.${String(c)} ${found}`);
    });
  });
  expand(table.down).forEach((boundary, c) => {
    boundary.forEach((want, r) => {
      const found = sideDiffers(want, linesAt(elements, x0 + c * w, y0 + (r + 0.5) * h, true));
      if (found) differs.push(`v${String(c)}.${String(r)} ${found}`);
    });
  });
  return differs;
}

describe('PowerPoint’s built-in table styles, as real PowerPoint draws them (X16, run 6)', () => {
  let root = '';
  let slides: SlideElement[][] = [];
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'drashti-table-families-'));
    const file = join(root, 'Placeholder table families.pptx');
    writeFileSync(
      file,
      editablePptxFixture({
        slides: POWERPOINT_RUN6_TABLES.map((table) => slideXml(tableXml(table))),
        parts: { 'ppt/theme/theme1.xml': THEME, 'ppt/tableStyles.xml': NO_DEFINITIONS },
      }),
    );
    const deck = await readEditablePptx(file, join(root, 'prepared'));
    slides = deck.slides.map((slide) => slide.elements);
  }, 60_000);
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads every table of run 6', () => {
    expect(slides).toHaveLength(POWERPOINT_RUN6_TABLES.length);
    expect(POWERPOINT_RUN6_TABLES).toHaveLength(114);
  });

  it.each(POWERPOINT_RUN6_TABLES.map((table, index) => ({ ...table, index })))(
    '$name',
    ({ index, ...table }) => {
      expect(differences(table, slides[index] ?? [])).toEqual([]);
    },
  );
});
