import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import { documentPageFromJson } from '../../shared/document-page';
import { openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import type * as Converters from './deck-converters';
import * as deckFlow from './deck/deck-flow';
import { readEditablePptx } from './deck/editable-pptx';
import { MediaStore } from './media-store';
import { OriginalsStore } from './originals-store';
import { runImport } from './pipeline';
import { editablePicture } from './testing/editable-pptx-fixture';
import { makeTestPdf } from './testing/make-pdf';
import { makeTestPptx } from './testing/make-pptx';
import { makeZip } from './testing/zip-writer';

const convert = vi.hoisted(() => vi.fn<typeof Converters.convertToPdf>());
vi.mock('./deck-converters', async (original) => {
  const actual = await original<typeof Converters>();
  return {
    ...actual,
    findConverters: () => Promise.resolve({ keynote: true, powerpoint: false }),
    convertersFor: (...[source, _platform, has]: Parameters<typeof Converters.convertersFor>) =>
      actual.convertersFor(source, 'darwin', has),
    convertToPdf: convert,
  };
});

const key = makeZip([{ name: 'Index/Document.iwa', data: Buffer.alloc(16) }]);
const pptx = makeTestPptx([
  { text: 'Placeholder first slide', color: '204060' },
  { text: 'Placeholder skipped slide', color: '204060', hidden: true },
  { text: 'Placeholder last slide', color: '204060' },
]);
const pdf = makeTestPdf([
  { text: 'Placeholder first slide', width: 960, height: 540, color: [32, 64, 96] },
  { text: 'Placeholder last slide', width: 960, height: 540, color: [32, 64, 96] },
]);
const slides = [
  { hidden: false, notes: '', animated: false },
  { hidden: true, notes: '', animated: false },
  { hidden: false, notes: '', animated: false },
];

beforeEach(() => {
  convert.mockReset();
});

it.each(['matched', 'mismatched', 'no export'] as const)(
  'keeps the editable Keynote source with the correct page order (%s)',
  async (kind) => {
    const root = mkdtempSync(join(tmpdir(), 'drashti-keynote-source-import-'));
    const source = join(root, 'Placeholder Keynote.key');
    const mediaDir = join(root, 'Media');
    mkdirSync(mediaDir);
    writeFileSync(source, key);
    const db = openDatabase(join(root, 'drashti.sqlite'));
    try {
      convert.mockImplementation((_app, _input, work) => {
        const picture = join(work, 'pictures.pdf');
        writeFileSync(picture, pdf);
        if (kind === 'no export')
          return Promise.resolve({
            ok: true,
            pdf: picture,
            slides: slides.filter((slide) => !slide.hidden),
            shownOnly: true,
          });
        const editablePptx = join(work, 'editable-source.pptx');
        writeFileSync(editablePptx, pptx);
        return Promise.resolve({ ok: true, pdf: picture, slides, shownOnly: false, editablePptx });
      });
      const media = new MediaStore(db, { dir: mediaDir, freeBytes: () => 1024 ** 4 });
      const written: string[] = [];
      const result = await runImport({
        db,
        media,
        runId: randomUUID(),
        paths: [source],
        options: {},
        baker: false,
        tempDir: root,
        onWrote: ({ presentationId }) => written.push(presentationId),
        drawPdf: (_input, outDir) => {
          mkdirSync(outDir, { recursive: true });
          const total = kind === 'mismatched' ? 1 : 2;
          const pages = Array.from({ length: total }, (_, index) => {
            const file = join(outDir, 'placeholder-' + String(index) + '.png');
            writeFileSync(file, editablePicture());
            return { index, file, notes: '' };
          });
          return Promise.resolve({ ok: true, width: 960, height: 540, pages, total, failed: [] });
        },
      });

      expect(result.totals).toMatchObject({ imported: 1, failed: 0 });
      expect(convert).toHaveBeenCalledTimes(1);
      const stored = new PresentationRepo(db).content(written[0] ?? '');
      const refs = stored?.slides.map((slide) => documentPageFromJson(slide.document_page));
      const originals = new OriginalsStore(db, mediaDir);
      const records = originals.list();
      expect(readFileSync(source)).toEqual(key);
      const original = records.find((record) => record.ext === 'key');
      if (!original) throw new Error('The original Keynote file was lost.');
      const kept = await originals.resolve(original);
      if (!kept) throw new Error('The original Keynote file was not retained.');
      expect(readFileSync(kept)).toEqual(key);
      const pictureSource = records.find((record) => record.ext === 'pdf');
      if (!pictureSource) throw new Error('The PDF playback source was lost.');
      const keptPdf = await originals.resolve(pictureSource);
      if (!keptPdf) throw new Error('The PDF playback source was not retained.');
      expect(readFileSync(keptPdf)).toEqual(pdf);

      if (kind !== 'matched') {
        expect(refs?.map((ref) => [ref?.ext, ref?.page])).toEqual(
          kind === 'mismatched'
            ? [['pdf', 0]]
            : [
                ['pdf', 0],
                ['pdf', 1],
              ],
        );
        expect(records.some((record) => record.ext === 'pptx')).toBe(false);
        return;
      }

      expect(refs?.map((ref) => [ref?.ext, ref?.page])).toEqual([
        ['pptx', 0],
        ['pptx', 2],
      ]);
      const derivative = records.find((record) => record.sha256 === refs?.[0]?.sha256);
      if (!derivative) throw new Error('The editable derivative was not registered.');
      const editable = await originals.resolve(derivative);
      if (!editable) throw new Error('The editable derivative was lost with the work folder.');
      expect(readFileSync(editable)).toEqual(pptx);
      const deck = await readEditablePptx(editable, join(root, 'prepared'));
      expect(deck.slides[2]?.elements.find((element) => element.kind === 'text')).toMatchObject({
        text: 'Placeholder last slide',
      });
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it.each([
  {
    label: 'valid',
    indices: [0, 2],
    expected: [
      ['pptx', 0],
      ['pptx', 2],
    ],
  },
  {
    label: 'duplicate',
    indices: [0, 0],
    expected: [
      ['key', 0],
      ['key', 1],
    ],
  },
  {
    label: 'out of range',
    indices: [0, 3],
    expected: [
      ['key', 0],
      ['key', 1],
    ],
  },
])('uses the baked Keynote copy only for valid page indices ($label)', async ({ indices, expected }) => {
  const root = mkdtempSync(join(tmpdir(), 'drashti-keynote-baked-source-'));
  const source = join(root, 'Placeholder Keynote.key');
  const mediaDir = join(root, 'Media');
  mkdirSync(mediaDir);
  writeFileSync(source, key);
  const db = openDatabase(join(root, 'drashti.sqlite'));
  const flow = vi.spyOn(deckFlow, 'runDeck').mockImplementationOnce(({ work, fileName }) => {
    const editablePptx = join(work, 'editable-source.pptx');
    writeFileSync(editablePptx, pptx);
    return Promise.resolve({
      kind: 'baked',
      editablePptx,
      editablePptxSlideCount: slides.length,
      sourceIndices: indices,
      parsed: {
        name: fileName,
        ref: null,
        width: 960,
        height: 540,
        notes: '',
        groups: [
          {
            name: 'Placeholder group',
            color: null,
            slides: indices.map(() => ({
              label: 'Placeholder page',
              notes: '',
              enabled: true,
              background: '#000000',
              elements: [],
              cues: [],
            })),
          },
        ],
        arrangements: [],
        selectedArrangement: null,
        media: [],
        issues: [],
      },
    });
  });
  try {
    const media = new MediaStore(db, { dir: mediaDir, freeBytes: () => 1024 ** 4 });
    const written: string[] = [];
    const result = await runImport({
      db,
      media,
      runId: randomUUID(),
      paths: [source],
      options: {},
      baker: false,
      tempDir: root,
      drawPdf: () => Promise.reject(new Error('The baked Keynote copy should not draw a PDF.')),
      onWrote: ({ presentationId }) => written.push(presentationId),
    });
    expect(result.totals).toMatchObject({ imported: 1, failed: 0 });
    expect(flow).toHaveBeenCalledOnce();
    const stored = new PresentationRepo(db).content(written[0] ?? '');
    expect(
      stored?.slides.map((slide) => {
        const ref = documentPageFromJson(slide.document_page);
        return [ref?.ext, ref?.page];
      }),
    ).toEqual(expected);
    const originals = new OriginalsStore(db, mediaDir).list();
    expect(originals.some((original) => original.ext === 'pptx')).toBe(expected[0]?.[0] === 'pptx');
  } finally {
    flow.mockRestore();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
