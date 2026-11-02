/**
 * Exact page geometry for a trusted, newly generated Chromium print only.
 * Input is ONLY a trusted fresh Chromium printToPDF result, never a source PDF.
 * Caller must obtain every ordered page ref/view/rotate from public PDF.js first.
 */
import { Buffer } from 'node:buffer';

const LIMITS = Object.freeze({
  bytes: 64 * 1024 * 1024,
  objects: 100_000,
  pages: 1_000,
  depth: 64,
  values: 1_000_000,
  dimension: 14_400,
  roundingDrift: 1,
});
const WHITE = new Set(['\0', '\t', '\n', '\f', '\r', ' ']);
const DELIMITERS = new Set(['(', ')', '[', ']', '{', '}', '<', '>', '/', '%']);
const isWhite = (value: string): boolean => WHITE.has(value);
const isDelimiter = (value: string): boolean => isWhite(value) || DELIMITERS.has(value);
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const UNSIGNED = /^\d+$/;
const PAGE_KEYS = new Set([
  'Type',
  'Parent',
  'Resources',
  'MediaBox',
  'CropBox',
  'Contents',
  'Rotate',
  'Tabs',
]);

/** Public PDF.js metadata for this exact fresh print, in page-tree order. */
export interface TrustedPrintPage {
  ref: { num: number; gen: number };
  view: readonly number[];
  rotate: number;
  target: { width: number; height: number };
}
export interface TrustedPrintGeometryOptions {
  provenance: 'fresh-chromium-print';
  pages: readonly TrustedPrintPage[];
}
export interface NormalizedPrintGeometry {
  bytes: Buffer;
  xrefOffset: number;
  pages: {
    ref: { num: number; gen: number };
    from: number[];
    to: number[];
    translation: number[];
  }[];
}
type ValueData =
  | { kind: 'name'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'ref'; num: number; gen: number }
  | { kind: 'dict'; entries: { key: PdfName; value: PdfValue }[] }
  | { kind: 'array'; items: PdfValue[] }
  | { kind: 'string' | 'hex' | 'true' | 'false' | 'null' };
type PdfValue = ValueData & { raw: string };
type PdfName = Extract<PdfValue, { kind: 'name' }>;
type PdfNumber = Extract<PdfValue, { kind: 'number' }>;
type PdfRef = Extract<PdfValue, { kind: 'ref' }>;
type PdfDictionary = Extract<PdfValue, { kind: 'dict' }>;
type PdfArray = Extract<PdfValue, { kind: 'array' }>;
interface ParsedObject {
  value: PdfValue;
  stream: { start: number; length: number } | null;
}
interface ParsedFile {
  xrefOffset: number;
  trailer: PdfDictionary;
  size: number;
  object: (ref: PdfValue | undefined, detail: string) => ParsedObject;
  pageRefs: PdfRef[];
}
interface ValidatedPage {
  ref: PdfRef;
  page: PdfDictionary;
  refs: PdfRef[];
  target: { width: number; height: number };
  oldBox: [number, number, number, number];
  dy: number;
}
export class TrustedPrintGeometryError extends Error {
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(`Trusted Chromium print geometry: ${detail}`);
    this.name = 'TrustedPrintGeometryError';
  }
}
function fail(code: string, detail: string): never {
  throw new TrustedPrintGeometryError(code, detail);
}
function invalid(detail: string): never {
  return fail('invalid-pdf', detail);
}
function integer(value: number, low: number, high: number, detail: string): number {
  if (!Number.isSafeInteger(value) || value < low || value > high) invalid(detail);
  return value;
}
function required<T>(value: T | undefined, detail: string): T {
  if (value === undefined) invalid(detail);
  return value;
}
function kind(node: PdfValue | undefined, type: 'name', detail: string): PdfName;
function kind(node: PdfValue | undefined, type: 'number', detail: string): PdfNumber;
function kind(node: PdfValue | undefined, type: 'ref', detail: string): PdfRef;
function kind(node: PdfValue | undefined, type: 'dict', detail: string): PdfDictionary;
function kind(node: PdfValue | undefined, type: 'array', detail: string): PdfArray;
function kind(node: PdfValue | undefined, type: ValueData['kind'], detail: string): PdfValue {
  if (!node || node.kind !== type) invalid(detail);
  return node;
}
function field(dict: PdfDictionary, name: string): PdfValue | undefined {
  return dict.entries.find((entry) => entry.key.value === name)?.value;
}
function numeric(node: PdfValue | undefined, detail: string): number {
  return kind(node, 'number', detail).value;
}
function nameIs(node: PdfValue | undefined, expected: string): boolean {
  return node?.kind === 'name' && node.value === expected;
}
function refKey(ref: PdfRef): string {
  return `${ref.num}:${ref.gen}`;
}
function asRef(node: PdfValue | undefined, detail: string): PdfRef {
  return kind(node, 'ref', detail);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Read backwards only from the final EOF, bounded to the same 1KiB trailer
// window as the prototype. This preserves PDF's NUL whitespace without a
// control-character regular expression or a scan through compressed streams.
function finalXref(text: string): number {
  const floor = Math.max(0, text.length - 1024);
  let position = text.length;
  const spaces = (): number => {
    const end = position;
    while (position > floor && isWhite(text.charAt(position - 1))) position--;
    return end - position;
  };
  spaces();
  if (text.slice(position - 5, position) !== '%%EOF') invalid('missing final startxref/EOF');
  position -= 5;
  if (spaces() === 0) invalid('missing final startxref/EOF');
  const numberEnd = position;
  while (position > floor && /[0-9]/.test(text.charAt(position - 1))) position--;
  if (position === numberEnd) invalid('missing final startxref/EOF');
  const value = Number(text.slice(position, numberEnd));
  if (spaces() === 0 || text.slice(position - 9, position) !== 'startxref')
    invalid('missing final startxref/EOF');
  position -= 9;
  if (position < floor || (position > floor && !/[\r\n]/.test(text.charAt(position - 1))))
    invalid('missing final startxref/EOF');
  return value;
}

// Tokenization only occurs at known object/xref offsets or within ordinary
// dictionaries. Stream bytes are skipped using their validated DIRECT Length.
// No /Page, endobj, dictionary or xref regex is run over compressed stream data.
class Reader {
  pos: number;
  constructor(
    private readonly text: string,
    start: number,
    private readonly end: number,
    private readonly budget: { values: number },
  ) {
    this.pos = start;
  }
  finished(): boolean {
    return this.pos === this.end;
  }
  skip(): void {
    while (this.pos < this.end) {
      const ch = this.text.charAt(this.pos);
      if (isWhite(ch)) this.pos++;
      else if (ch === '%') {
        while (this.pos < this.end && !/[\r\n]/.test(this.text.charAt(this.pos))) this.pos++;
      } else break;
    }
  }
  word(): string {
    this.skip();
    const start = this.pos;
    while (this.pos < this.end && !isDelimiter(this.text.charAt(this.pos))) this.pos++;
    if (this.pos === start) invalid('missing ordinary token');
    return this.text.slice(start, this.pos);
  }
  peek(word: string): boolean {
    this.skip();
    return (
      this.text.startsWith(word, this.pos) &&
      (this.pos + word.length === this.end || isDelimiter(this.text.charAt(this.pos + word.length)))
    );
  }
  expect(word: string): void {
    if (!this.peek(word)) invalid(`expected ${word}`);
    this.pos += word.length;
  }
  value(depth = 0): PdfValue {
    if (depth > LIMITS.depth || ++this.budget.values > LIMITS.values)
      fail('limits', 'object nesting/value limit exceeded');
    this.skip();
    const start = this.pos;
    if (this.pos >= this.end) invalid('unexpected end of object');
    const ch = this.text.charAt(this.pos);
    let node: ValueData;
    if (ch === '/') {
      this.pos++;
      const nameStart = this.pos;
      while (this.pos < this.end && !isDelimiter(this.text.charAt(this.pos))) this.pos++;
      const encoded = this.text.slice(nameStart, this.pos);
      if (/#(?![0-9a-fA-F]{2})/.test(encoded)) invalid('invalid name escape');
      node = {
        kind: 'name',
        value: encoded.replace(/#([0-9a-fA-F]{2})/g, (_match: string, hex: string) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        ),
      };
    } else if (ch === '(') {
      this.pos++;
      let level = 1;
      while (this.pos < this.end && level > 0) {
        const item = this.text.charAt(this.pos++);
        if (item === '\\') {
          if (this.pos >= this.end) invalid('unfinished literal string escape');
          if (this.text.charAt(this.pos) === '\r' && this.text.charAt(this.pos + 1) === '\n') this.pos += 2;
          else this.pos++;
        } else if (item === '(') level++;
        else if (item === ')') level--;
        if (level > LIMITS.depth) fail('limits', 'literal string nesting limit exceeded');
      }
      if (level !== 0) invalid('unfinished literal string');
      node = { kind: 'string' };
    } else if (this.text.startsWith('<<', this.pos)) {
      this.pos += 2;
      const entries: PdfDictionary['entries'] = [];
      const names = new Set<string>();
      for (;;) {
        this.skip();
        if (this.text.startsWith('>>', this.pos)) {
          this.pos += 2;
          break;
        }
        const key = kind(this.value(depth + 1), 'name', 'dictionary key is not a name');
        if (names.has(key.value)) invalid('duplicate dictionary key');
        names.add(key.value);
        entries.push({ key, value: this.value(depth + 1) });
      }
      node = { kind: 'dict', entries };
    } else if (ch === '<') {
      this.pos++;
      while (this.pos < this.end && this.text.charAt(this.pos) !== '>') {
        if (!/[0-9a-fA-F]/.test(this.text.charAt(this.pos)) && !isWhite(this.text.charAt(this.pos)))
          invalid('invalid hexadecimal string');
        this.pos++;
      }
      if (this.pos >= this.end) invalid('unfinished hexadecimal string');
      this.pos++;
      node = { kind: 'hex' };
    } else if (ch === '[') {
      this.pos++;
      const items: PdfValue[] = [];
      for (;;) {
        this.skip();
        if (this.text.charAt(this.pos) === ']') {
          this.pos++;
          break;
        }
        items.push(this.value(depth + 1));
      }
      node = { kind: 'array', items };
    } else {
      const word = this.word();
      if (NUMBER.test(word)) {
        const number = Number(word);
        if (!Number.isFinite(number) || Math.abs(number) > 1e12) invalid('number outside supported range');
        node = { kind: 'number', value: number };
        const afterNumber = this.pos;
        if (UNSIGNED.test(word)) {
          // References use two nonnegative integers followed by R. Roll back
          // lookahead for ordinary numeric arrays, never consume their items.
          this.skip();
          if (this.pos < this.end && !isDelimiter(this.text.charAt(this.pos))) {
            const generation = this.word();
            if (UNSIGNED.test(generation) && this.peek('R')) {
              this.pos++;
              node = {
                kind: 'ref',
                num: integer(number, 1, LIMITS.objects, 'invalid reference number'),
                gen: integer(Number(generation), 0, 65535, 'invalid generation'),
              };
            } else this.pos = afterNumber;
          } else this.pos = afterNumber;
        }
      } else if (word === 'true' || word === 'false' || word === 'null') node = { kind: word };
      else invalid('unsupported ordinary object token');
    }
    return { ...node, raw: this.text.slice(start, this.pos) };
  }
}

function parseFile(bytes: Buffer): ParsedFile {
  const text = bytes.toString('latin1');
  if (!/^%PDF-1\.[3-7](?:\r\n|\r|\n)/.test(bytes.subarray(0, 16).toString('latin1')))
    fail('unsupported-pdf', 'only ordinary PDF 1.3–1.7 fresh prints are supported');
  const xrefOffset = integer(finalXref(text), 9, bytes.length - 1, 'invalid startxref offset');
  const budget = { values: 0 };
  const reader = new Reader(text, xrefOffset, text.length, budget);
  if (!reader.peek('xref')) fail('unsupported-pdf', 'xref streams are not supported');
  reader.expect('xref');
  const entries = new Map<number, { number: number; offset: number; gen: number; status: 'n' | 'f' }>();
  while (!reader.peek('trailer')) {
    const first = integer(Number(reader.word()), 0, LIMITS.objects, 'invalid xref subsection');
    const count = integer(Number(reader.word()), 1, LIMITS.objects, 'invalid xref count');
    if (first + count > LIMITS.objects) fail('limits', 'xref object limit exceeded');
    for (let index = 0; index < count; index++) {
      const off = reader.word();
      const gen = reader.word();
      const status = reader.word();
      if (!/^\d{10}$/.test(off) || !/^\d{5}$/.test(gen) || (status !== 'n' && status !== 'f'))
        invalid('invalid classic xref entry');
      const number = first + index;
      if (entries.has(number)) invalid('overlapping xref subsections');
      entries.set(number, { number, offset: Number(off), gen: Number(gen), status });
    }
  }
  reader.expect('trailer');
  const trailer = kind(reader.value(), 'dict', 'missing trailer dictionary');
  for (const entry of trailer.entries) {
    if (['Encrypt', 'XRefStm', 'Prev'].includes(entry.key.value))
      fail('unsupported-pdf', `unsupported trailer ${entry.key.value}`);
    if (!['Size', 'Root', 'Info', 'ID'].includes(entry.key.value))
      fail('unsupported-pdf', 'unknown fresh-print trailer field');
  }
  const size = integer(
    numeric(field(trailer, 'Size'), 'missing trailer Size'),
    1,
    LIMITS.objects,
    'invalid Size',
  );
  if (entries.size !== size || [...entries.keys()].some((number) => number >= size))
    invalid('xref is not a complete fresh-print table');
  const zero = entries.get(0);
  if (!zero || zero.status !== 'f' || zero.gen !== 65535) invalid('missing free object zero');
  reader.expect('startxref');
  if (reader.word() !== String(xrefOffset)) invalid('startxref mismatch');
  reader.skip();
  if (!reader.finished()) invalid('unexpected trailing bytes'); // skip consumes the final %%EOF comment.

  const live = [...entries.values()]
    .filter((entry) => entry.status === 'n')
    .sort((a, b) => a.offset - b.offset);
  const objects = new Map<number, ParsedObject>();
  for (const [index, entry] of live.entries()) {
    if (entry.number === 0 || entry.gen !== 0)
      fail('unsupported-pdf', 'nonzero live generations are not fresh-print layout');
    integer(entry.offset, 9, xrefOffset - 1, 'object offset outside body');
    const end = live[index + 1]?.offset ?? xrefOffset;
    if (end <= entry.offset) invalid('duplicate/overlapping object offsets');
    const objectReader = new Reader(text, entry.offset, end, budget);
    if (objectReader.word() !== String(entry.number) || objectReader.word() !== '0')
      invalid('xref/object identity mismatch');
    objectReader.expect('obj');
    const value = objectReader.value();
    if (value.kind === 'dict' && ['ObjStm', 'XRef'].some((type) => nameIs(field(value, 'Type'), type)))
      fail('unsupported-pdf', 'compressed object/xref streams are not supported');
    let stream: ParsedObject['stream'] = null;
    if (objectReader.peek('stream')) {
      if (value.kind !== 'dict') invalid('stream lacks dictionary');
      const lengthNode = field(value, 'Length');
      if (lengthNode?.kind === 'ref') fail('unsupported-pdf', 'indirect stream Length is not supported');
      const length = integer(
        numeric(lengthNode, 'stream lacks direct Length'),
        0,
        LIMITS.bytes,
        'invalid stream Length',
      );
      objectReader.expect('stream');
      if (text.startsWith('\r\n', objectReader.pos)) objectReader.pos += 2;
      else if (/[\r\n]/.test(text.charAt(objectReader.pos))) objectReader.pos++;
      else invalid('missing stream header EOL');
      const start = objectReader.pos;
      if (start + length >= end) invalid('stream Length exceeds object boundary');
      objectReader.pos = start + length;
      if (text.startsWith('\r\n', objectReader.pos)) objectReader.pos += 2;
      else if (/[\r\n]/.test(text.charAt(objectReader.pos))) objectReader.pos++;
      // No skip here: an incorrect Length must not be hidden by a comment/token scan.
      if (!text.startsWith('endstream', objectReader.pos) || !isDelimiter(text.charAt(objectReader.pos + 9)))
        invalid('stream Length/endstream mismatch');
      objectReader.pos += 9;
      stream = { start, length };
    }
    objectReader.expect('endobj');
    objectReader.skip();
    if (!objectReader.finished()) invalid('unparsed bytes between xref objects');
    objects.set(entry.number, { value, stream });
  }
  const object = (value: PdfValue | undefined, detail: string): ParsedObject => {
    const ref = asRef(value, detail);
    if (ref.gen !== 0) invalid(detail);
    return required(objects.get(ref.num), detail);
  };
  const rootRef = asRef(field(trailer, 'Root'), 'missing catalog reference');
  const catalog = kind(
    object(rootRef, 'invalid catalog reference').value,
    'dict',
    'catalog is not dictionary',
  );
  if (!nameIs(field(catalog, 'Type'), 'Catalog')) invalid('root is not Catalog');
  for (const key of [
    'AcroForm',
    'Outlines',
    'Dests',
    'Names',
    'OpenAction',
    'AA',
    'StructTreeRoot',
    'OCProperties',
  ]) {
    if (field(catalog, key))
      fail('unsupported-pdf', `interactive/tagged catalog ${key} is outside the trusted-print layout`);
  }
  const infoRef = field(trailer, 'Info');
  if (infoRef)
    kind(
      object(asRef(infoRef, 'invalid Info reference'), 'missing Info object').value,
      'dict',
      'Info is not dictionary',
    );
  const id = field(trailer, 'ID');
  if (
    id &&
    (id.kind !== 'array' ||
      id.items.length !== 2 ||
      id.items.some((item) => !['string', 'hex'].includes(item.kind)))
  )
    invalid('invalid trailer ID');
  const pageRefs: PdfRef[] = [];
  const visited = new Set<string>();
  const walk = (ref: PdfRef, parent: PdfRef | null = null, depth = 0): number => {
    if (depth > LIMITS.depth) fail('limits', 'page-tree depth limit exceeded');
    const key = refKey(asRef(ref, 'invalid page-tree reference'));
    if (visited.has(key)) invalid('duplicate/cyclic page tree');
    visited.add(key);
    const page = kind(object(ref, 'invalid page-tree object').value, 'dict', 'invalid page-tree dictionary');
    if (parent) {
      const parentRef = asRef(field(page, 'Parent'), 'missing page-tree Parent');
      if (refKey(parentRef) !== refKey(parent)) invalid('page-tree Parent mismatch');
    }
    if (nameIs(field(page, 'Type'), 'Page')) {
      pageRefs.push(ref);
      if (pageRefs.length > LIMITS.pages) fail('limits', 'page limit exceeded');
      return 1;
    }
    if (!nameIs(field(page, 'Type'), 'Pages')) invalid('page tree has invalid Type');
    if (page.entries.some((entry) => !['Type', 'Parent', 'Kids', 'Count'].includes(entry.key.value)))
      fail('unsupported-page', 'inherited/unknown page-tree attributes are unsupported');
    const kids = kind(field(page, 'Kids'), 'array', 'Pages lacks Kids').items;
    let count = 0;
    for (const kid of kids) count += walk(asRef(kid, 'invalid page-tree reference'), ref, depth + 1);
    if (count !== numeric(field(page, 'Count'), 'Pages lacks Count')) invalid('page-tree Count mismatch');
    return count;
  };
  walk(asRef(field(catalog, 'Pages'), 'catalog lacks Pages'));
  if (!pageRefs.length) fail('unsupported-pdf', 'empty print has no pages');
  return { xrefOffset, trailer, size, object, pageRefs };
}

function box(node: PdfValue | undefined, detail: string): [number, number, number, number] {
  const items = kind(node, 'array', detail).items;
  if (items.length !== 4) invalid(detail);
  return [
    numeric(items[0], detail),
    numeric(items[1], detail),
    numeric(items[2], detail),
    numeric(items[3], detail),
  ];
}
function decimal(value: number, exact = false): string {
  if (!Number.isFinite(value) || Math.abs(value) > LIMITS.dimension)
    fail('target-geometry', 'coordinate outside supported range');
  let text = value.toFixed(8).replace(/\.?0+$/, '');
  if (!text || text === '-0') text = '0';
  if (exact && Number(text) !== value)
    fail('target-geometry', 'targets require at most eight decimal places');
  return text;
}
function validatePage(file: ParsedFile, ref: PdfRef, metadata: unknown): ValidatedPage {
  const page = kind(file.object(ref, 'invalid page ref').value, 'dict', 'page is not dictionary');
  for (const entry of page.entries) {
    if (!PAGE_KEYS.has(entry.key.value))
      fail('unsupported-page', `unsupported page field ${entry.key.value}`);
  }
  const rotate = field(page, 'Rotate');
  if (rotate && (rotate.kind !== 'number' || rotate.value !== 0))
    fail('unsupported-page', 'nonzero page Rotate requires quadrant-aware correction');
  const resources = field(page, 'Resources');
  if (!resources || !['dict', 'ref'].includes(resources.kind)) invalid('page lacks own Resources');
  if (resources.kind === 'ref')
    kind(file.object(resources, 'missing Resources object').value, 'dict', 'Resources is not dictionary');
  const oldBox = box(field(page, 'MediaBox'), 'page lacks direct MediaBox');
  if (oldBox[0] !== 0 || oldBox[1] !== 0 || oldBox[2] <= 0 || oldBox[3] <= 0)
    fail('unsupported-page', 'only zero-origin positive MediaBox is supported');
  const crop = field(page, 'CropBox');
  if (crop && box(crop, 'invalid CropBox').some((value, axis) => value !== oldBox[axis]))
    fail('unsupported-page', 'cropped print requires separate clipping policy');
  if (!record(metadata))
    fail('page-metadata', 'ordered public PDF.js ref/view/rotation does not match actual page');
  const suppliedRef = metadata['ref'];
  const suppliedView = metadata['view'];
  if (
    !record(suppliedRef) ||
    suppliedRef['num'] !== ref.num ||
    suppliedRef['gen'] !== ref.gen ||
    metadata['rotate'] !== 0 ||
    !Array.isArray(suppliedView)
  )
    fail('page-metadata', 'ordered public PDF.js ref/view/rotation does not match actual page');
  const view: readonly unknown[] = suppliedView;
  if (
    view.length !== 4 ||
    view.some(
      (value, index) =>
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        Math.abs(value - required(oldBox[index], 'invalid MediaBox')) > 1e-7,
    )
  )
    fail('page-metadata', 'ordered public PDF.js ref/view/rotation does not match actual page');
  const requested = metadata['target'];
  if (!record(requested))
    fail('target-geometry', 'only small Chromium page-size quantization corrections are supported');
  const width = requested['width'];
  const height = requested['height'];
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width > LIMITS.dimension ||
    height > LIMITS.dimension ||
    Math.abs(width - oldBox[2]) > LIMITS.roundingDrift ||
    Math.abs(height - oldBox[3]) > LIMITS.roundingDrift
  )
    fail('target-geometry', 'only small Chromium page-size quantization corrections are supported');
  const target = { width, height };
  decimal(target.width, true);
  decimal(target.height, true);
  const contents = field(page, 'Contents');
  const values = contents?.kind === 'array' ? contents.items : [contents];
  if (!values.length) fail('unsupported-page', 'Contents must be stream references or an array of them');
  const refs: PdfRef[] = [];
  for (const item of values) {
    if (item?.kind !== 'ref' || !file.object(item, 'missing Contents stream').stream)
      fail('unsupported-page', 'Contents must be stream references or an array of them');
    refs.push(item);
  }
  const dy = Number(decimal(target.height - oldBox[3]));
  return { ref, page, refs, target, oldBox, dy };
}

/**
 * Only call on the just-completed Main printToPDF Buffer. The provenance field
 * is a caller assertion, not proof that received/source bytes came from Chromium.
 * Runtime validation remains at this binary boundary; no arbitrary-source IPC.
 */
export function normalizeTrustedChromiumPrint(input: unknown, options: unknown): NormalizedPrintGeometry {
  if (!record(options) || options['provenance'] !== 'fresh-chromium-print')
    fail('provenance', 'caller must attest fresh-chromium-print provenance');
  if (!(input instanceof Uint8Array)) invalid('input must be binary bytes');
  if (input.byteLength < 32 || input.byteLength > LIMITS.bytes) fail('limits', 'print byte limit exceeded');
  // Snapshot first; preserve the complete original revision byte-for-byte.
  const original = Buffer.from(input);
  const file = parseFile(original);
  const suppliedPages = options['pages'];
  if (!Array.isArray(suppliedPages) || suppliedPages.length !== file.pageRefs.length)
    fail('page-metadata', 'supply every public PDF.js page in order');
  const metadata: readonly unknown[] = suppliedPages;
  const pages = file.pageRefs.map((ref, index) => validatePage(file, ref, metadata[index]));
  if (file.size + pages.length * 2 > LIMITS.objects)
    fail('limits', 'incremental object count exceeds output limit');
  const chunks = [original, Buffer.from('\n% Exact geometry for a trusted fresh Chromium print.\n')];
  let length = chunks.reduce((sum, part) => sum + part.length, 0);
  let nextObject = file.size;
  const updates = new Map<number, number>();
  function appendObject(num: number, body: string): void {
    if (updates.has(num)) invalid('duplicate incremental object');
    updates.set(num, length);
    const bytes = Buffer.from(`${num} 0 obj\n${body}\nendobj\n`, 'latin1');
    chunks.push(bytes);
    length += bytes.length;
  }
  function streamObject(num: number, content: string): void {
    appendObject(num, `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`);
  }
  for (const page of pages) {
    const prefix = nextObject++;
    const suffix = nextObject++;
    const kept = page.page.entries
      .filter((entry) => !['MediaBox', 'CropBox', 'Contents'].includes(entry.key.value))
      .map((entry) => `${entry.key.raw} ${entry.value.raw}`);
    const exactBox = `[0 0 ${decimal(page.target.width, true)} ${decimal(page.target.height, true)}]`;
    appendObject(
      page.ref.num,
      `<<\n${kept.join('\n')}\n/MediaBox ${exactBox}\n/CropBox ${exactBox}\n/Contents [${prefix} 0 R ${page.refs.map((ref) => `${ref.num} ${ref.gen} R`).join(' ')} ${suffix} 0 R]\n>>`,
    );
    streamObject(prefix, `q\n1 0 0 1 0 ${decimal(page.dy)} cm\n`);
    streamObject(suffix, 'Q\n');
  }
  const xrefOffset = length;
  const ordered = [...updates.keys()].sort((a, b) => a - b);
  let xref = 'xref\n';
  for (let index = 0; index < ordered.length;) {
    const start = index;
    const first = required(ordered[index++], 'missing xref subsection');
    while (
      index < ordered.length &&
      ordered[index] === required(ordered[index - 1], 'missing prior xref entry') + 1
    )
      index++;
    xref += `${first} ${index - start}\n`;
    for (let row = start; row < index; row++)
      xref += `${String(required(updates.get(required(ordered[row], 'missing output object number')), 'missing output object offset')).padStart(10, '0')} 00000 n \n`;
  }
  const preserved = file.trailer.entries
    .filter((entry) => ['Root', 'Info', 'ID'].includes(entry.key.value))
    .map((entry) => `${entry.key.raw} ${entry.value.raw}`);
  xref += `trailer\n<<\n/Size ${nextObject}\n${preserved.join('\n')}\n/Prev ${file.xrefOffset}\n>>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return {
    bytes: Buffer.concat(chunks),
    xrefOffset,
    pages: pages.map((page) => ({
      ref: { num: page.ref.num, gen: page.ref.gen },
      from: [page.oldBox[2], page.oldBox[3]],
      to: [page.target.width, page.target.height],
      translation: [0, page.dy],
    })),
  };
}
