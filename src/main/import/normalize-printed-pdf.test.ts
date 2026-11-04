// Port of the independently verified external trusted-print prototype and its twelve cases.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { normalizeTrustedChromiumPrint, TrustedPrintGeometryError } from './normalize-printed-pdf';
import type { NormalizedPrintGeometry, TrustedPrintPage } from './normalize-printed-pdf';

interface FixturePage {
  width: number;
  height: number;
  origin?: [number, number];
  crop?: number[];
  target?: { width: number; height: number };
  array?: boolean;
  rotate?: number;
  extra?: string;
}
interface FixtureOptions {
  catalogExtra?: string;
  fontObject?: string;
  trailerExtra?: string;
}
interface FixtureInput {
  bytes: Buffer;
  publicPages: TrustedPrintPage[];
}
function required<T>(value: T | undefined): T {
  assert.ok(value !== undefined, 'Generated parser fixture is complete.');
  return value;
}
function objectAt(objects: Map<number, string>, num: number): string {
  return required(objects.get(num));
}

// Synthetic generated ASCII content only. This is a parser/writer fixture, not an
// assertion that Type1 Helvetica can represent the Unicode proof below.
function fixture(
  pageSpecs: FixturePage[] = [{ width: 480, height: 319.91998 }],
  options: FixtureOptions = {},
): FixtureInput & { streams: Buffer[]; xref: number; pageIds: number[] } {
  const objects = new Map<number, string | Buffer>();
  objects.set(1, `<< /Type /Catalog /Pages 2 0 R ${options.catalogExtra ?? ''} >>`);
  objects.set(3, options.fontObject ?? '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const publicPages: TrustedPrintPage[] = [];
  const pageIds: number[] = [];
  const streams: Buffer[] = [];
  for (const [index, spec] of pageSpecs.entries()) {
    const pageId = 4 + index * 3;
    const contentId = pageId + 1;
    const tailId = pageId + 2;
    pageIds.push(pageId);
    const origin: [number, number] = spec.origin ?? [0, 0];
    const box = [...origin, origin[0] + spec.width, origin[1] + spec.height];
    const commands = Buffer.from(
      'q\n0.2 0.4 0.7 rg\n40 50 30 20 re f\nQ\nBT /F1 12 Tf 1 0 0 1 24 270 Tm (Placeholder ' +
        String(index) +
        ') Tj ET\n% xref /Type /Page /MediaBox [0 0 1 1] endobj stream\n',
    );
    const compressed = deflateSync(commands);
    streams.push(compressed);
    objects.set(
      contentId,
      Buffer.concat([
        Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),
        compressed,
        Buffer.from('\nendstream'),
      ]),
    );
    objects.set(tailId, '<< /Length 4 >>\nstream\nq Q\n\nendstream');
    const contents = spec.array ? `[${contentId} 0 R ${tailId} 0 R]` : `${contentId} 0 R`;
    const crop = spec.crop ? `/CropBox [${spec.crop.join(' ')}]` : '';
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /MediaBox [${box.join(' ')}] ${crop} /Contents ${contents} ${spec.rotate === undefined ? '' : `/Rotate ${spec.rotate}`} ${spec.extra ?? ''} >>`,
    );
    publicPages.push({
      ref: { num: pageId, gen: 0 },
      view: spec.crop ?? box,
      rotate: spec.rotate ?? 0,
      target: spec.target ?? { width: Math.round(spec.width), height: Math.round(spec.height) },
    });
  }
  objects.set(
    2,
    `<< /Type /Pages /Count ${pageSpecs.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`,
  );
  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [0];
  let length = required(chunks[0]).length;
  for (let id = 1; id <= objects.size; id++) {
    offsets[id] = length;
    const body = required(objects.get(id));
    const bytes = Buffer.concat([
      Buffer.from(`${id} 0 obj\n`),
      Buffer.isBuffer(body) ? body : Buffer.from(body),
      Buffer.from('\nendobj\n'),
    ]);
    chunks.push(bytes);
    length += bytes.length;
  }
  const xref = length;
  const lines = offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.size + 1}\n0000000000 65535 f \n${lines}trailer\n<< /Size ${objects.size + 1} /Root 1 0 R ${options.trailerExtra ?? ''} >>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  );
  return { bytes: Buffer.concat(chunks), publicPages, streams, xref, pageIds };
}

function call(input: FixtureInput, pages: unknown = input.publicPages): NormalizedPrintGeometry {
  return normalizeTrustedChromiumPrint(input.bytes, { provenance: 'fresh-chromium-print', pages });
}

// Independent check of the incremental section only; never search the original
// compressed stream body for /Page, /Contents or endobj tokens.
function appendedObjects(result: NormalizedPrintGeometry): {
  objects: Map<number, string>;
  trailer: string;
  xrefOffset: number;
} {
  const text = result.bytes.toString('latin1');
  const tail = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text);
  assert.ok(tail);
  const xrefOffset = Number(required(tail[1]));
  const lines = text.slice(xrefOffset).split(/\r?\n/);
  assert.equal(lines.shift(), 'xref');
  const objects = new Map<number, string>();
  while (lines[0] !== 'trailer') {
    const parts = required(lines.shift()).split(' ').map(Number);
    const first = required(parts[0]);
    const count = required(parts[1]);
    for (let i = 0; i < count; i++) {
      const [offset, generation, status] = required(lines.shift()).trim().split(/\s+/);
      assert.equal(generation, '00000');
      assert.equal(status, 'n');
      const start = Number(offset);
      const end = text.indexOf('\nendobj', start);
      assert.ok(end > start && end < xrefOffset);
      objects.set(first + i, text.slice(start, end));
    }
  }
  return { objects, trailer: lines.join('\n'), xrefOffset };
}

function rejected(input: FixtureInput, code?: string, pages: unknown = input.publicPages): void {
  const before = Buffer.from(input.bytes);
  assert.throws(
    () => call(input, pages),
    (error: unknown) => {
      assert.ok(error instanceof TrustedPrintGeometryError);
      if (code) assert.equal(error.code, code);
      return true;
    },
  );
  assert.deepEqual(input.bytes, before);
}

test('exact requested boxes with top-origin translation; fonts/vector/content bytes preserved', () => {
  const input = fixture();
  const before = Buffer.from(input.bytes);
  const result = call(input);
  assert.deepEqual(input.bytes, before);
  assert.deepEqual(result.bytes.subarray(0, before.length), before);
  const { objects, trailer, xrefOffset } = appendedObjects(result);
  assert.match(objectAt(objects, 4), /\/MediaBox \[0 0 480 320\]/);
  assert.match(objectAt(objects, 4), /\/CropBox \[0 0 480 320\]/);
  assert.match(objectAt(objects, 4), /\/Resources << \/Font << \/F1 3 0 R >> >>/);
  assert.match(objectAt(objects, 4), /\/Contents \[\d+ 0 R 5 0 R \d+ 0 R\]/);
  const streams = [...objects.values()].filter((value) => value.includes('\nstream\n'));
  assert.ok(streams.some((value) => value.endsWith('stream\nq\n1 0 0 1 0 0.08002 cm\n\nendstream')));
  assert.ok(streams.some((value) => value.endsWith('stream\nQ\n\nendstream')));
  assert.match(trailer, new RegExp(`/Prev ${input.xref}\\b`));
  assert.match(trailer, /\/Root 1 0 R/);
  assert.equal(result.xrefOffset, xrefOffset);
  assert.deepEqual(required(result.pages[0]).translation, [0, 0.08002]);
  // Point (40,50) has identical top-origin landmark after translation/box repair.
  assert.ok(
    Math.abs(319.91998 - 50 - (320 - (50 + required(required(result.pages[0]).translation[1])))) < 1e-10,
  );
  for (const stream of input.streams) assert.ok(result.bytes.includes(stream));
});

test('mixed page sizes and Contents arrays get their own correction without scaling', () => {
  const input = fixture([
    { width: 480, height: 319.91998, array: true, target: { width: 480, height: 320 } },
    { width: 612, height: 791.94, target: { width: 612, height: 792 } },
    { width: 321.02, height: 240, target: { width: 321, height: 240 } },
  ]);
  const result = call(input);
  const { objects } = appendedObjects(result);
  assert.match(objectAt(objects, 4), /\/Contents \[\d+ 0 R 5 0 R 6 0 R \d+ 0 R\]/);
  assert.match(objectAt(objects, 7), /\/MediaBox \[0 0 612 792\]/);
  assert.match(objectAt(objects, 10), /\/CropBox \[0 0 321 240\]/);
  assert.deepEqual(
    result.pages.map((page) => page.translation),
    [
      [0, 0.08002],
      [0, 0.06],
      [0, 0],
    ],
  );
});

test('already exact page still has exact boxes and unchanged original content', () => {
  const input = fixture([{ width: 480, height: 320 }]);
  const result = call(input);
  assert.deepEqual(required(result.pages[0]).translation, [0, 0]);
  assert.match(objectAt(appendedObjects(result).objects, 4), /\/MediaBox \[0 0 480 320\]/);
  assert.deepEqual(result.bytes.subarray(0, input.bytes.length), input.bytes);
});

test('requires explicit fresh-print provenance and independently verified complete page refs/views', () => {
  const input = fixture();
  assert.throws(
    () => normalizeTrustedChromiumPrint(input.bytes, { pages: input.publicPages }),
    /fresh-chromium-print/,
  );
  rejected(input, 'page-metadata', []);
  rejected(input, 'page-metadata', [{ ...input.publicPages[0], ref: { num: 5, gen: 0 } }]);
  rejected(input, 'page-metadata', [{ ...input.publicPages[0], view: [0, 0, 480, 320] }]);
  rejected(input, 'page-metadata', [{ ...input.publicPages[0], rotate: 90 }]);
});

for (const rotate of [90, 180, 270]) {
  test(`rejects /Rotate ${rotate} rather than applying an incorrect zero-rotation translation`, () => {
    rejected(fixture([{ width: 480, height: 319.91998, rotate }]), 'unsupported-page');
  });
}

test('rejects crop/origin/annotation/user-unit/inherited/duplicate page-key layouts', () => {
  rejected(fixture([{ width: 480, height: 319.91998, origin: [1, 2] }]), 'unsupported-page');
  rejected(fixture([{ width: 480, height: 319.91998, crop: [0, 0, 470, 310] }]), 'unsupported-page');
  rejected(fixture([{ width: 480, height: 319.91998, extra: '/Annots []' }]), 'unsupported-page');
  rejected(fixture([{ width: 480, height: 319.91998, extra: '/UserUnit 2' }]), 'unsupported-page');
  rejected(fixture([{ width: 480, height: 319.91998, extra: '/MediaBox [0 0 480 320]' }]), 'invalid-pdf');
});

test('rejects resizing, invalid targets and stale/mismatched PDF.js metadata', () => {
  const input = fixture();
  for (const target of [
    { width: 400, height: 320 },
    { width: NaN, height: 320 },
    { width: 480, height: 0 },
    { width: 480, height: Infinity },
  ]) {
    rejected(input, 'target-geometry', [{ ...input.publicPages[0], target }]);
  }
});

test('rejects encrypted, hybrid, prior-incremental, object-stream and interactive catalog PDFs', () => {
  for (const trailerExtra of ['/Encrypt 3 0 R', '/XRefStm 1', '/Prev 1'])
    rejected(fixture(undefined, { trailerExtra }), 'unsupported-pdf');
  rejected(fixture(undefined, { catalogExtra: '/AcroForm << >>' }), 'unsupported-pdf');
  rejected(
    fixture(undefined, { fontObject: '<< /Type /ObjStm /N 0 /First 0 /Length 0 >>\nstream\n\nendstream' }),
    'unsupported-pdf',
  );
  rejected(
    fixture([{ width: 480, height: 319.91998, extra: '/Foo << /Type /ObjStm >>' }]),
    'unsupported-page',
  );
});

test('does not accept its own incremental result or silently normalize it twice', () => {
  const input = fixture();
  const result = call(input);
  rejected({ bytes: result.bytes, publicPages: input.publicPages }, 'unsupported-pdf');
});

test('malformed xref offset and stream length fail without altering source bytes', () => {
  const input = fixture();
  const badXref = Buffer.from(input.bytes);
  const row = badXref.indexOf(Buffer.from('0000000015 00000 n'));
  assert.ok(row >= 0);
  badXref.write('0000000016', row, 'ascii');
  rejected({ bytes: badXref, publicPages: input.publicPages }, 'invalid-pdf');
  const text = input.bytes.toString('latin1');
  const length = /\/Length (\d+) \/Filter/.exec(text);
  assert.ok(length);
  const badLength = Buffer.from(input.bytes);
  const originalLength = required(length[1]);
  badLength.write(
    String(Number(originalLength) + 2).padStart(originalLength.length, '0'),
    length.index + '/Length '.length,
    'ascii',
  );
  rejected({ bytes: badLength, publicPages: input.publicPages }, 'invalid-pdf');
});

// The independent public PDF.js Unicode/landmark proof and hidden Electron
// exact-box/assembly proof cover the generated print beyond these binary cases.
