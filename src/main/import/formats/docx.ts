import { open } from 'node:fs/promises';
import type { ImportIssue } from '../../../shared/import';
import type { TextRun } from '../../../shared/model';
import { legacyFontOf, LegacyFontUse } from '../legacy-fonts';
import type { ParsedPresentation } from '../model';
import { XmlError, parseXml } from '../xml';
import type { XmlNode } from '../xml';
import { listZip, readZipEntries, ZipError } from '../zip';
import { lyricsPresentation } from './text';

/*
 * Word (.docx) lyrics (Session 26f; PLAN §2). A Word document is a zip of
 * XML parts: its words are in word/document.xml, its styles' fonts in
 * word/styles.xml. Each paragraph is a line and an empty paragraph starts a
 * new slide, as in a .txt lyrics file, and the lines go through the same
 * code (./text.ts), so [headers], repeats and languages work alike. A line
 * break (Shift+Enter) is a line too, and a page break a new slide.
 *
 * Kept: the words as written, Gujarati, Hindi and English, and a run typed
 * in a legacy font (its own, its paragraph style's or the document's), which
 * is kept as typed in that font as other importers keep one (legacy-fonts.ts).
 * Left out, and said so: formatting (the slides take their theme's look),
 * pictures and drawings, tables (and their words), hidden words. Deleted
 * words of tracked changes, field codes, footnotes, headers and footers are
 * not the document's words and are not read.
 *
 * Read with Drashti's own zip reader and XML reader: nothing else is needed.
 * A damaged file, a password-protected one (Word saves those as an encrypted
 * compound file, not a zip) and an old .doc renamed .docx each get a plain
 * message.
 */

/** The most a Word file's words (word/document.xml) may be, once unpacked. */
export const MAX_DOCX_XML_BYTES = 16 * 1024 * 1024;

export type DocxResult =
  | { ok: true; parsed: ParsedPresentation }
  | { ok: false; code: 'damaged' | 'not-word' | 'protected' | 'old-word' | 'too-large'; message: string };

const DAMAGED =
  'This Word file could not be read: it may be damaged. If it opens in Word, save it again there and import that.';
const NOT_WORD =
  'This is not a Word document: it holds no document. If it opens in Word, save it again there and import that.';
const PROTECTED =
  'This Word file is protected with a password. Open it in Word, take the password off (File › Info › Protect Document), save it, and import it again.';
const OLD_WORD =
  'This is an old Word document (.doc) with a .docx name. Open it in Word and save it as a Word Document (.docx), then import that.';
const TOO_LARGE = `This Word file holds more words than a lyrics file can (over ${String(MAX_DOCX_XML_BYTES / 1024 / 1024)} MB of them). Split it into smaller documents and import those.`;

/** An old-style compound file (a .doc, or Word's encrypted package): its first eight bytes. */
const COMPOUND = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Not a zip: what it is instead, from its first bytes (and, for a compound file, whether it is encrypted). */
async function notAZip(path: string): Promise<DocxResult> {
  const fh = await open(path, 'r');
  try {
    const head = Buffer.alloc(8);
    await fh.read(head, 0, 8, 0);
    if (!COMPOUND.every((b, i) => head[i] === b)) return { ok: false, code: 'damaged', message: DAMAGED };
    // Its streams' names are UTF-16 in its directory: a password-protected Word file holds "EncryptedPackage".
    const { size } = await fh.stat();
    const body = Buffer.alloc(Math.min(size, 64 * 1024 * 1024));
    await fh.read(body, 0, body.length, 0);
    return body.includes(Buffer.from('EncryptedPackage', 'utf16le'))
      ? { ok: false, code: 'protected', message: PROTECTED }
      : { ok: false, code: 'old-word', message: OLD_WORD };
  } finally {
    await fh.close();
  }
}

// ---- fonts ------------------------------------------------------------------------------------

interface Styles {
  /** Each style's own font and the style it is based on. */
  byId: Map<string, { font: string | null; basedOn: string | null }>;
  /** The document's default font. */
  font: string | null;
}

const child = (node: XmlNode | undefined, name: string) => node?.children.find((c) => c.name === name);

/** The font a run's properties name for its letters (a theme's font is never a legacy one). */
function fontIn(rPr: XmlNode | undefined): string | null {
  const f = child(rPr, 'w:rFonts');
  return f ? (f.attrs['w:ascii'] ?? f.attrs['w:hAnsi'] ?? f.attrs['w:cs'] ?? null) : null;
}

function readStyles(xml: Buffer | undefined): Styles {
  const styles: Styles = { byId: new Map(), font: null };
  if (!xml) return styles;
  let root: XmlNode;
  try {
    root = parseXml(xml.toString('utf8'));
  } catch {
    // Styles that cannot be read: the runs' own fonts still count.
    return styles;
  }
  styles.font = fontIn(child(child(child(root, 'w:docDefaults'), 'w:rPrDefault'), 'w:rPr'));
  for (const s of root.children) {
    const id = s.name === 'w:style' ? s.attrs['w:styleId'] : undefined;
    if (!id) continue;
    styles.byId.set(id, {
      font: fontIn(child(s, 'w:rPr')),
      basedOn: child(s, 'w:basedOn')?.attrs['w:val'] ?? null,
    });
  }
  return styles;
}

/** A style's font, or the one of the style it is based on (a few deep at most). */
function styleFont(styles: Styles, id: string | undefined): string | null {
  for (let at = id, depth = 0; at && depth < 10; depth++) {
    const s = styles.byId.get(at);
    if (!s) return null;
    if (s.font) return s.font;
    at = s.basedOn ?? undefined;
  }
  return null;
}

// ---- the document -----------------------------------------------------------------------------

/** What was read, and what was left out. */
interface Reading {
  styles: Styles;
  /** The lines so far, each as runs (an empty line starts a new slide). */
  lines: TextRun[][];
  current: TextRun[];
  formatting: boolean;
  hidden: boolean;
  pictures: number;
  tables: number;
}

/** Run properties that are formatting (left out); the font is read, and the rest says nothing visible. */
const RUN_FORMATTING = new Set([
  'w:b',
  'w:bCs',
  'w:i',
  'w:iCs',
  'w:u',
  'w:strike',
  'w:dstrike',
  'w:color',
  'w:sz',
  'w:szCs',
  'w:highlight',
  'w:shd',
  'w:caps',
  'w:smallCaps',
  'w:vertAlign',
  'w:em',
  'w:outline',
  'w:shadow',
  'w:emboss',
  'w:imprint',
  'w:spacing',
  'w:w',
  'w:position',
  'w:effect',
  'w:bdr',
]);
const PARAGRAPH_FORMATTING = new Set(['w:jc', 'w:ind', 'w:spacing', 'w:numPr', 'w:shd', 'w:pBdr', 'w:tabs']);
/** What holds drawn things: a picture, a shape, a chart, an embedded object. */
const DRAWN = new Set(['w:drawing', 'w:pict', 'w:object']);

/** A property that is on (Word writes w:val="0" or "false" to turn one off). */
const isOn = (node: XmlNode | undefined): boolean =>
  node !== undefined && node.attrs['w:val'] !== '0' && node.attrs['w:val'] !== 'false';

const formatted = (props: XmlNode | undefined, kinds: Set<string>) =>
  props?.children.some((c) => kinds.has(c.name) && isOn(c)) ?? false;

function holdsDrawing(node: XmlNode): boolean {
  return DRAWN.has(node.name) || node.children.some(holdsDrawing);
}

function endLine(r: Reading): void {
  r.lines.push(r.current);
  r.current = [];
}

/** A run's words, in its font: a legacy one kept, any other left to the theme. */
function readRun(run: XmlNode, paragraphFont: string | null, r: Reading): void {
  const rPr = child(run, 'w:rPr');
  if (formatted(rPr, RUN_FORMATTING)) r.formatting = true;
  if (isOn(child(rPr, 'w:vanish')) || isOn(child(rPr, 'w:specVanish'))) {
    if (run.children.some((c) => c.name === 'w:t' && c.text !== '')) r.hidden = true;
    return;
  }
  const font =
    fontIn(rPr) ??
    styleFont(r.styles, child(rPr, 'w:rStyle')?.attrs['w:val']) ??
    paragraphFont ??
    r.styles.font;
  const kept = font && legacyFontOf(font) ? font : undefined;
  const add = (text: string) => {
    r.current.push(kept ? { text, font: kept } : { text });
  };
  for (const c of run.children) {
    // A line end inside a run's text is a space to Word.
    if (c.name === 'w:t') add(c.text.replace(/[\r\n]/gu, ' '));
    else if (c.name === 'w:tab' || c.name === 'w:ptab') add('\t');
    else if (c.name === 'w:noBreakHyphen') add('-');
    else if (c.name === 'w:cr') endLine(r);
    else if (c.name === 'w:br') {
      endLine(r);
      // A page (or column) break: a new slide, as an empty paragraph is.
      if (c.attrs['w:type'] === 'page' || c.attrs['w:type'] === 'column') endLine(r);
    } else if (DRAWN.has(c.name) || (c.name === 'mc:AlternateContent' && holdsDrawing(c))) r.pictures++;
  }
}

/** What a paragraph holds: runs, and runs inside links, fields, content controls and tracked insertions. */
function readInline(node: XmlNode, paragraphFont: string | null, r: Reading): void {
  for (const c of node.children) {
    if (c.name === 'w:r') readRun(c, paragraphFont, r);
    else if (
      c.name === 'w:hyperlink' ||
      c.name === 'w:smartTag' ||
      c.name === 'w:sdt' ||
      c.name === 'w:sdtContent' ||
      c.name === 'w:customXml' ||
      c.name === 'w:fldSimple' ||
      c.name === 'w:ins' ||
      c.name === 'w:moveTo' ||
      c.name === 'w:dir' ||
      c.name === 'w:bdo'
    )
      readInline(c, paragraphFont, r);
    else if (c.name === 'mc:AlternateContent' && holdsDrawing(c)) r.pictures++;
    // w:del and w:moveFrom (words taken out), w:pPr, bookmarks, comments and equations are not words.
  }
}

function readParagraph(p: XmlNode, r: Reading): void {
  const pPr = child(p, 'w:pPr');
  if (formatted(pPr, PARAGRAPH_FORMATTING)) r.formatting = true;
  if (formatted(child(pPr, 'w:rPr'), RUN_FORMATTING)) r.formatting = true;
  readInline(p, styleFont(r.styles, child(pPr, 'w:pStyle')?.attrs['w:val']), r);
  endLine(r);
}

function readBlocks(node: XmlNode, r: Reading): void {
  for (const c of node.children) {
    if (c.name === 'w:p') readParagraph(c, r);
    else if (c.name === 'w:tbl') r.tables++;
    else if (
      c.name === 'w:sdt' ||
      c.name === 'w:sdtContent' ||
      c.name === 'w:customXml' ||
      c.name === 'w:ins'
    )
      readBlocks(c, r);
  }
}

/** A line's runs as the lyrics format reads a line: tabs as spaces, trimmed at both ends, empty runs gone. */
function tidyLine(runs: TextRun[]): { text: string; runs: TextRun[] } {
  const spaced = runs.map((run) => ({ ...run, text: run.text.replace(/\t/gu, ' ') }));
  const whole = spaced.map((run) => run.text).join('');
  let lead = whole.length - whole.trimStart().length;
  let trail = whole.length - whole.trimEnd().length;
  for (const run of spaced) {
    const cut = Math.min(lead, run.text.length);
    run.text = run.text.slice(cut);
    lead -= cut;
  }
  for (const run of [...spaced].reverse()) {
    const cut = Math.min(trail, run.text.length);
    run.text = run.text.slice(0, run.text.length - cut);
    trail -= cut;
  }
  return { text: whole.trim(), runs: spaced.filter((run) => run.text !== '') };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('{n}', String(n)));

/** A Word file's lyrics as a presentation, or why it cannot be read. `fileName` names it. */
export async function readDocx(path: string, fileName: string): Promise<DocxResult> {
  let parts: Map<string, Buffer>;
  try {
    parts = await readZipEntries(
      path,
      (name) => name === 'word/document.xml' || name === 'word/styles.xml',
      MAX_DOCX_XML_BYTES,
    );
  } catch (error) {
    if (error instanceof ZipError && error.message.includes('end of central directory')) return notAZip(path);
    return { ok: false, code: 'damaged', message: DAMAGED };
  }
  const documentXml = parts.get('word/document.xml');
  if (!documentXml) {
    // There, but bigger than a lyrics file can be (the reader leaves those out)?
    const entry = (await listZip(path).catch(() => [])).find((e) => e.name === 'word/document.xml');
    return entry
      ? entry.size > MAX_DOCX_XML_BYTES || entry.compressedSize > MAX_DOCX_XML_BYTES
        ? { ok: false, code: 'too-large', message: TOO_LARGE }
        : { ok: false, code: 'damaged', message: DAMAGED }
      : { ok: false, code: 'not-word', message: NOT_WORD };
  }
  let body: XmlNode | undefined;
  try {
    body = child(parseXml(documentXml.toString('utf8')), 'w:body');
  } catch (error) {
    if (error instanceof XmlError) return { ok: false, code: 'damaged', message: DAMAGED };
    throw error;
  }
  if (!body) return { ok: false, code: 'damaged', message: DAMAGED };
  const reading: Reading = {
    styles: readStyles(parts.get('word/styles.xml')),
    lines: [],
    current: [],
    formatting: false,
    hidden: false,
    pictures: 0,
    tables: 0,
  };
  readBlocks(body, reading);
  if (reading.current.length > 0) endLine(reading);

  // The lines, as the lyrics format reads them, and each line's runs where a legacy font is kept.
  const tidy = reading.lines.map(tidyLine);
  const typed = new Map<string, (TextRun[] | null)[]>();
  for (const line of tidy) {
    const queue = typed.get(line.text) ?? [];
    queue.push(line.runs.some((run) => run.font !== undefined) ? line.runs : null);
    typed.set(line.text, queue);
  }
  const issues: ImportIssue[] = [];
  if (reading.formatting)
    issues.push({
      severity: 'info',
      code: 'formatting-left-out',
      message:
        'Its formatting (bold, colours, sizes, alignment) was left out: the slides take their theme’s look.',
      fix: null,
    });
  if (reading.hidden)
    issues.push({
      severity: 'info',
      code: 'hidden-left-out',
      message: 'Hidden words were left out.',
      fix: null,
    });
  if (reading.pictures > 0)
    issues.push({
      severity: 'warning',
      code: 'pictures-left-out',
      message: plural(reading.pictures, 'A picture was left out.', '{n} pictures were left out.'),
      fix: null,
    });
  if (reading.tables > 0)
    issues.push({
      severity: 'warning',
      code: 'tables-left-out',
      message: plural(
        reading.tables,
        'A table was left out, and the words in it.',
        '{n} tables were left out, and the words in them.',
      ),
      fix: null,
    });
  const legacy = new LegacyFontUse();
  const parsed = lyricsPresentation(tidy.map((line) => line.text).join('\n'), fileName, issues, {
    runsOf: (line) => typed.get(line)?.shift() ?? null,
    legacy,
  });
  parsed.issues.push(...legacy.issues());
  return { ok: true, parsed };
}
