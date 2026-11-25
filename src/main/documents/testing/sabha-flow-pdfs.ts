import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  beginText,
  concatTransformationMatrix,
  drawObject,
  endText,
  PDFDocument,
  PDFHexString,
  PDFName,
  type PDFPage,
  type PDFRef,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFontAndSize,
  setTextMatrix,
  showText,
} from 'pdf-lib';
import { sfntFromWoff } from '../../import/testing/embedded-font';

/*
 * Tests only (alpha.23, Sabha flow): placeholder running-order PDFs, made the way a word processor makes them: a text
 * layer of embedded fonts (Drashti's own bundled Noto Sans, its Gujarati and its Devanagari; SIL Open Font License
 * 1.1) with ToUnicode maps, and a table's borders as stroked lines or thin filled boxes. pdf-lib writes the file; the
 * fonts are embedded here by hand (each character its glyph by the font's own cmap, no shaping: the text layer is
 * what is read, not the look). Placeholder words only, never anything real.
 */

const require = createRequire(import.meta.url);

interface Font {
  key: 'latin' | 'gu' | 'hi';
  bytes: Buffer;
  unitsPerEm: number;
  glyphOf(cp: number): number;
  advance(gid: number): number;
}

function tables(sfnt: Buffer): Map<string, Buffer> {
  const map = new Map<string, Buffer>();
  const count = sfnt.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const at = 12 + 16 * i;
    const offset = sfnt.readUInt32BE(at + 8);
    map.set(sfnt.toString('latin1', at, at + 4), sfnt.subarray(offset, offset + sfnt.readUInt32BE(at + 12)));
  }
  return map;
}

function cmapLookup(cmap: Buffer): (cp: number) => number {
  const count = cmap.readUInt16BE(2);
  let format4: Buffer | null = null;
  let format12: Buffer | null = null;
  for (let i = 0; i < count; i++) {
    const platform = cmap.readUInt16BE(4 + 8 * i);
    const encoding = cmap.readUInt16BE(6 + 8 * i);
    const sub = cmap.subarray(cmap.readUInt32BE(8 + 8 * i));
    const format = sub.readUInt16BE(0);
    if (platform === 3 && encoding === 10 && format === 12) format12 = sub;
    if ((platform === 3 && encoding === 1) || platform === 0) if (format === 4) format4 ??= sub;
  }
  if (format12) {
    const table = format12;
    const groups = table.readUInt32BE(12);
    return (cp) => {
      for (let g = 0; g < groups; g++) {
        const at = 16 + 12 * g;
        const start = table.readUInt32BE(at);
        if (cp >= start && cp <= table.readUInt32BE(at + 4)) return table.readUInt32BE(at + 8) + cp - start;
      }
      return 0;
    };
  }
  if (!format4) throw new Error('The font has no Unicode cmap.');
  const table = format4;
  const segX2 = table.readUInt16BE(6);
  const ends = 14;
  const starts = 16 + segX2;
  const deltas = 16 + 2 * segX2;
  const ranges = 16 + 3 * segX2;
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let s = 0; s < segX2 / 2; s++) {
      if (cp > table.readUInt16BE(ends + 2 * s)) continue;
      const start = table.readUInt16BE(starts + 2 * s);
      if (cp < start) return 0;
      const delta = table.readUInt16BE(deltas + 2 * s);
      const range = table.readUInt16BE(ranges + 2 * s);
      if (range === 0) return (cp + delta) & 0xffff;
      const glyph = table.readUInt16BE(ranges + 2 * s + range + 2 * (cp - start));
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
}

function loadFont(key: Font['key'], woff: string): Font {
  const bytes = sfntFromWoff(readFileSync(require.resolve(woff)));
  const t = tables(bytes);
  const head = t.get('head');
  const hhea = t.get('hhea');
  const hmtx = t.get('hmtx');
  const cmap = t.get('cmap');
  if (!head || !hhea || !hmtx || !cmap) throw new Error(`The font ${woff} lacks a table.`);
  const metrics = hhea.readUInt16BE(34);
  return {
    key,
    bytes,
    unitsPerEm: head.readUInt16BE(18),
    glyphOf: cmapLookup(cmap),
    advance: (gid) => hmtx.readUInt16BE(4 * Math.min(gid, metrics - 1)),
  };
}

let fonts: Record<Font['key'], Font> | undefined;
function theFonts(): Record<Font['key'], Font> {
  fonts ??= {
    latin: loadFont('latin', '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'),
    gu: loadFont('gu', '@fontsource/noto-sans-gujarati/files/noto-sans-gujarati-gujarati-400-normal.woff'),
    hi: loadFont(
      'hi',
      '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff',
    ),
  };
  return fonts;
}

const scriptOf = (cp: number): Font['key'] =>
  cp >= 0x0a80 && cp <= 0x0aff ? 'gu' : (cp >= 0x0900 && cp <= 0x097f) || cp === 0xa8e0 ? 'hi' : 'latin';

/** How the text layer maps glyphs back to characters. */
export type FlowPdfMapping =
  /** As it should: each glyph its character. */
  | 'unicode'
  /** Each glyph to a private-use character (a font with no real Unicode map): unreadable. */
  | 'private-use';

export interface FlowPdfText {
  text: string;
  /** Left edge and baseline, in points from the page's top-left. */
  x: number;
  y: number;
  size: number;
}

export interface FlowPdfRule {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface FlowPdfPage {
  width: number;
  height: number;
  texts: FlowPdfText[];
  rules: FlowPdfRule[];
  /** How the borders are drawn: stroked lines (default) or thin filled boxes (as Word draws them). */
  ruleStyle?: 'lines' | 'boxes';
  /** A picture over the whole page (a scan): placeholder grey. */
  picture?: boolean;
}

export interface FlowPdfOptions {
  mapping?: FlowPdfMapping;
  /**
   * The short i (Gujarati િ, Devanagari ि) written before its consonant in the text layer, in the order it is seen,
   * as some programs write it.
   */
  shortIFirst?: boolean;
}

const PRE_BASE = new Set([0x0abf, 0x093f]);

interface Used {
  font: Font;
  ref: PDFRef;
  name: string;
  glyphs: Map<number, string>;
}

function hex4(n: number): string {
  return n.toString(16).padStart(4, '0').toUpperCase();
}

function utf16Hex(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) out += hex4(text.charCodeAt(i));
  return out;
}

/** A PDF of the given pages: its text in the bundled fonts, its rules as borders. */
export async function makeFlowPdf(
  pages: readonly FlowPdfPage[],
  options: FlowPdfOptions = {},
): Promise<Uint8Array> {
  const mapping = options.mapping ?? 'unicode';
  const doc = await PDFDocument.create();
  doc.setProducer('Drashti tests');
  doc.setCreator('Drashti tests');
  const all = theFonts();
  const used = new Map<Font['key'], Used>();
  const fontFor = (key: Font['key']): Used => {
    let u = used.get(key);
    if (!u) {
      const font = all[key];
      u = { font, ref: doc.context.nextRef(), name: `F${String(used.size + 1)}`, glyphs: new Map() };
      used.set(key, u);
    }
    return u;
  };
  const made: { page: PDFPage; spec: FlowPdfPage }[] = [];
  for (const spec of pages) {
    const page = doc.addPage([spec.width, spec.height]);
    made.push({ page, spec });
    if (spec.picture) {
      const w = 64;
      const h = 64;
      const pixels = new Uint8Array(w * h);
      for (let i = 0; i < pixels.length; i++) pixels[i] = 160 + ((i * 7) % 60);
      const image = doc.context.register(
        doc.context.flateStream(pixels, {
          Type: 'XObject',
          Subtype: 'Image',
          Width: w,
          Height: h,
          ColorSpace: 'DeviceGray',
          BitsPerComponent: 8,
        }),
      );
      page.node.setXObject(PDFName.of('Im1'), image);
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(spec.width, 0, 0, spec.height, 0, 0),
        drawObject('Im1'),
        popGraphicsState(),
      );
    }
    for (const rule of spec.rules) {
      const flip = (y: number) => spec.height - y;
      if (spec.ruleStyle === 'boxes') {
        const across = rule.y0 === rule.y1;
        page.drawRectangle({
          x: Math.min(rule.x0, rule.x1) - (across ? 0 : 0.25),
          y: flip(Math.max(rule.y0, rule.y1)) - (across ? 0.25 : 0),
          width: across ? Math.abs(rule.x1 - rule.x0) : 0.5,
          height: across ? 0.5 : Math.abs(rule.y1 - rule.y0),
          color: rgb(0, 0, 0),
        });
      } else
        page.drawLine({
          start: { x: rule.x0, y: flip(rule.y0) },
          end: { x: rule.x1, y: flip(rule.y1) },
          thickness: 0.75,
          color: rgb(0, 0, 0),
        });
    }
    for (const text of spec.texts) {
      // Runs of one script each, in one font each, one after another along the baseline.
      const cps: number[] = [];
      for (const c of text.text.normalize('NFC')) cps.push(c.codePointAt(0) ?? 0);
      if (options.shortIFirst)
        for (let i = 1; i < cps.length; i++) {
          const here = cps[i] ?? 0;
          if (PRE_BASE.has(here)) [cps[i - 1], cps[i]] = [here, cps[i - 1] ?? 0];
        }
      let x = text.x;
      let k = 0;
      // A space stays in the run it is in when that run's font has one (as a word processor keeps a run's font).
      const keys: Font['key'][] = [];
      for (const cp of cps) {
        const script = scriptOf(cp);
        const before = keys[keys.length - 1];
        keys.push(
          script === 'latin' && cp === 0x20 && before && all[before].glyphOf(cp) !== 0 ? before : script,
        );
      }
      while (k < cps.length) {
        const key = keys[k] ?? 'latin';
        let end = k;
        while (end < cps.length && keys[end] === key) end++;
        const u = fontFor(key);
        let hex = '';
        let advance = 0;
        for (const cp of cps.slice(k, end)) {
          const gid = u.font.glyphOf(cp);
          if (gid === 0) throw new Error(`No glyph for U+${hex4(cp)} in the ${key} font.`);
          if (!u.glyphs.has(gid))
            u.glyphs.set(
              gid,
              mapping === 'unicode' ? String.fromCodePoint(cp) : String.fromCodePoint(0xe000 + gid),
            );
          hex += hex4(gid);
          advance += (u.font.advance(gid) / u.font.unitsPerEm) * text.size;
        }
        page.node.setFontDictionary(PDFName.of(u.name), u.ref);
        page.pushOperators(
          beginText(),
          setFontAndSize(u.name, text.size),
          setTextMatrix(1, 0, 0, 1, x, spec.height - text.y),
          showText(PDFHexString.of(hex)),
          endText(),
        );
        x += advance;
        k = end;
      }
    }
  }
  for (const u of used.values()) {
    const { font } = u;
    const file = doc.context.register(doc.context.flateStream(font.bytes, { Length1: font.bytes.length }));
    const descriptor = doc.context.register(
      doc.context.obj({
        Type: 'FontDescriptor',
        FontName: `Drashti${u.name}`,
        Flags: 32,
        FontBBox: [-600, -400, 2000, 1200],
        ItalicAngle: 0,
        Ascent: 1069,
        Descent: -293,
        CapHeight: 714,
        StemV: 80,
        FontFile2: file,
      }),
    );
    const gids = [...u.glyphs.keys()].sort((a, b) => a - b);
    const widths: (number | number[])[] = [];
    for (const gid of gids) widths.push(gid, [Math.round((font.advance(gid) * 1000) / font.unitsPerEm)]);
    const cid = doc.context.register(
      doc.context.obj({
        Type: 'Font',
        Subtype: 'CIDFontType2',
        BaseFont: `Drashti${u.name}`,
        CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
        FontDescriptor: descriptor,
        CIDToGIDMap: 'Identity',
        DW: 1000,
        W: widths,
      }),
    );
    const chars = [...u.glyphs.entries()].sort((a, b) => a[0] - b[0]);
    const blocks: string[] = [];
    for (let i = 0; i < chars.length; i += 100) {
      const part = chars.slice(i, i + 100);
      blocks.push(
        `${String(part.length)} beginbfchar\n${part.map(([g, t]) => `<${hex4(g)}> <${utf16Hex(t)}>`).join('\n')}\nendbfchar`,
      );
    }
    const cmap = [
      '/CIDInit /ProcSet findresource begin',
      '12 dict begin',
      'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /Adobe-Identity-UCS def',
      '/CMapType 2 def',
      '1 begincodespacerange',
      '<0000> <FFFF>',
      'endcodespacerange',
      ...blocks,
      'endcmap',
      'CMapName currentdict /CMap defineresource pop',
      'end',
      'end',
    ].join('\n');
    const toUnicode = doc.context.register(doc.context.flateStream(cmap));
    doc.context.assign(
      u.ref,
      doc.context.obj({
        Type: 'Font',
        Subtype: 'Type0',
        BaseFont: `Drashti${u.name}`,
        Encoding: 'Identity-H',
        DescendantFonts: [cid],
        ToUnicode: toUnicode,
      }),
    );
  }
  return doc.save();
}

/** A table cell: its words ('\n' between its lines), or merged over this many rows (from its own). */
export type FlowCell = string | { text: string; rows: number } | null;

export interface FlowTableSpec {
  title?: string;
  subtitle?: string;
  /** The header row, the number column's first; left out: a table with no header row. */
  headers?: string[];
  /** Each row: its number first, then its cells; null where a merged cell from above covers it. */
  rows: FlowCell[][];
  /** Column widths in points (A4 is 595 wide). */
  widths: number[];
  total?: string;
  borders?: 'lines' | 'boxes' | 'none';
  /** Where a merged cell's words sit: at its top (Word's default) or in its middle. */
  mergedAlign?: 'top' | 'middle';
  size?: number;
}

/** The page of a table as a word processor lays it out: title, subtitle, header, rows, total. */
export function flowTablePage(spec: FlowTableSpec): FlowPdfPage {
  const width = 595;
  const height = 842;
  const size = spec.size ?? 10;
  const line = size * 1.35;
  const pad = 4;
  const texts: FlowPdfText[] = [];
  const rules: FlowPdfRule[] = [];
  const left = (width - spec.widths.reduce((a, b) => a + b, 0)) / 2;
  const xs = [left];
  for (const w of spec.widths) xs.push((xs[xs.length - 1] ?? left) + w);
  let y = 56;
  if (spec.title) {
    texts.push({ text: spec.title, x: left, y, size: size * 1.6 });
    y += size * 2.4;
  }
  if (spec.subtitle) {
    texts.push({ text: spec.subtitle, x: left, y, size: size * 1.2 });
    y += size * 2;
  }
  const lines = (cell: FlowCell): string[] =>
    cell === null ? [] : (typeof cell === 'string' ? cell : cell.text).split('\n');
  const rows: FlowCell[][] = [...(spec.headers ? [spec.headers] : []), ...spec.rows];
  // Each row's height: its tallest cell that is its own (a merged cell fits in the rows it covers).
  const heights = rows.map(
    (row) =>
      Math.max(
        1,
        ...row.map((cell) => (cell === null || typeof cell !== 'string' ? 1 : lines(cell).length)),
      ) *
        line +
      2 * pad,
  );
  const tops = [y];
  for (const h of heights) tops.push((tops[tops.length - 1] ?? y) + h);
  const bottom = tops[tops.length - 1] ?? y;
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell === null) return;
      const span = typeof cell === 'string' ? 1 : cell.rows;
      const top = tops[r] ?? 0;
      const end = tops[Math.min(r + span, rows.length)] ?? bottom;
      const words = lines(cell);
      const block = words.length * line;
      const first = span > 1 && spec.mergedAlign === 'middle' ? top + (end - top - block) / 2 : top + pad;
      words.forEach((text, k) => {
        if (text !== '') texts.push({ text, x: (xs[c] ?? 0) + pad, y: first + k * line + size, size });
      });
    });
  });
  if (spec.borders !== 'none') {
    const columns = spec.widths.length;
    // Across: the table's top and bottom, and between rows, but not inside a merged cell.
    rules.push({ x0: left, y0: y, x1: xs[columns] ?? left, y1: y });
    for (let r = 1; r <= rows.length; r++)
      for (let c = 0; c < columns; c++) {
        const covered = r < rows.length && rows[r]?.[c] === null;
        if (!covered) rules.push({ x0: xs[c] ?? 0, y0: tops[r] ?? 0, x1: xs[c + 1] ?? 0, y1: tops[r] ?? 0 });
      }
    for (const x of xs) rules.push({ x0: x, y0: y, x1: x, y1: bottom });
  }
  if (spec.total) texts.push({ text: spec.total, x: left, y: bottom + size * 2, size });
  return { width, height, texts, rules, ruleStyle: spec.borders === 'boxes' ? 'boxes' : 'lines' };
}

/** A numbered list (no table): a title, then one line per item, its number first. */
export function flowListPage(spec: {
  title?: string;
  lines: string[];
  total?: string;
  size?: number;
}): FlowPdfPage {
  const size = spec.size ?? 11;
  const texts: FlowPdfText[] = [];
  let y = 60;
  if (spec.title) {
    texts.push({ text: spec.title, x: 60, y, size: size * 1.6 });
    y += size * 3;
  }
  for (const text of spec.lines) {
    texts.push({ text, x: /^\s/u.test(text) ? 84 : 60, y, size });
    y += size * 1.6;
  }
  if (spec.total) texts.push({ text: spec.total, x: 60, y: y + size, size });
  return { width: 595, height: 842, texts, rules: [] };
}

/** A scan: one page that is only a picture, with no text layer. */
export function flowScanPage(): FlowPdfPage {
  return { width: 595, height: 842, texts: [], rules: [], picture: true };
}
