import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import { documentPageFromJson } from '../../shared/document-page';
import { MAX_PAGE_TEXT } from '../../shared/pictures';
import { openDatabase } from '../db/database';
import { ImportRepo } from '../db/imports';
import { PresentationRepo } from '../db/presentations';
import type * as Converters from './deck-converters';
import * as bake from './deck/bake';
import * as deckFlow from './deck/deck-flow';
import { readEditablePptx } from './deck/editable-pptx';
import type { PptxMedia } from './deck/pptx-deck';
import { MediaStore } from './media-store';
import { OriginalsStore } from './originals-store';
import { keynotePagesShifted, type PptxDeck, type PptxSlide, readPptx } from './pictures';
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
  { text: 'Placeholder first slide', color: '204060', font: 'Kruti Dev 010' },
  { text: 'Placeholder skipped slide', color: '204060', hidden: true },
  { text: 'Placeholder last slide', color: '204060' },
]);
const page = (text: string) => ({
  text,
  width: 960,
  height: 540,
  color: [32, 64, 96] as [number, number, number],
});
const first = 'Placeholder first slide';
const last = 'Placeholder last slide';
const slides = [
  { hidden: false, notes: 'Placeholder first notes', animated: false, pageText: first },
  { hidden: true, notes: '', animated: false, pageText: 'Placeholder skipped slide' },
  { hidden: false, notes: 'Placeholder last notes', animated: true, pageText: last },
];
/** The log's line when the copy is set aside, for PDF pages in the order last, first (C15's review, L6). */
const KEYNOTE_COPY_SET_ASIDE =
  'Keynote: PDF page 1 has the words of slide 3 of its PowerPoint copy (by the page count, slide 1), and another page confirms the shift, so the copy was set aside and Edit slides uses the PDF';

beforeEach(() => {
  convert.mockReset();
});

it('keeps the PowerPoint copy when the only word differences are page numbers', () => {
  const numbered = [1, 2].map((number) => ({
    hidden: false,
    notes: '',
    animated: false,
    pageText: 'Placeholder numbered slide ' + String(number),
  }));
  const pages = [2, 1].map((number, index) => ({
    index,
    pageText: 'Placeholder numbered slide ' + String(number),
  }));
  expect(keynotePagesShifted(numbered, { total: 2, pages })).toBe(false);
});

/** A slide of the copy with these words (null: none, as a picture's), skipped in the slide show or not. */
const slideOf = (words: string | null, hidden = false): PptxSlide => ({
  hidden,
  notes: '',
  animated: false,
  ...(words === null ? {} : { pageText: words }),
});
/** The PDF's pages in order, with these words (null: none, as pdf.js gives a page over 4,096 characters). */
const pdfOf = (...words: (string | null)[]) => ({
  total: words.length,
  pages: words.map((pageText, index) => (pageText === null ? { index } : { index, pageText })),
});
const VERSE = 'Placeholder verse line';
const CHORUS = 'Placeholder chorus words';
const VERSE_TWO = 'Placeholder second verse line';
const LINE_ONE = 'Placeholder line one';
const LINES_TWO = `${LINE_ONE} line two`;
const LINES_THREE = `${LINES_TWO} line three`;

/** A rule's case: the copy's slides by their words (or skipped), the PDF's pages, and whether the copy is set aside. */
interface CopyCase {
  rule: string;
  slides: (string | null | { skipped: string })[];
  pdf: ReturnType<typeof pdfOf>;
  shifted: boolean;
}
const COPY_CASES: CopyCase[] = [
  { rule: 'pages in the copy’s order', slides: [VERSE, CHORUS], pdf: pdfOf(VERSE, CHORUS), shifted: false },
  { rule: 'two pages swapped', slides: [VERSE, CHORUS], pdf: pdfOf(CHORUS, VERSE), shifted: true },
  {
    rule: 'one page with another slide’s words leaves the copy available',
    slides: [VERSE, CHORUS, VERSE_TWO],
    pdf: pdfOf(VERSE, VERSE_TWO, VERSE_TWO),
    shifted: false,
  },
  {
    rule: 'a chorus repeated, in order',
    slides: [VERSE, CHORUS, VERSE_TWO, CHORUS],
    pdf: pdfOf(VERSE, CHORUS, VERSE_TWO, CHORUS),
    shifted: false,
  },
  {
    rule: 'a page with a repeated chorus’s words names neither slide',
    slides: [VERSE, CHORUS, CHORUS],
    pdf: pdfOf(CHORUS, null, CHORUS),
    shifted: false,
  },
  {
    rule: 'slides built line by line, two swapped (one holds the other’s words)',
    slides: [LINE_ONE, LINES_TWO, LINES_THREE],
    pdf: pdfOf(LINES_TWO, LINE_ONE, LINES_THREE),
    shifted: false,
  },
  {
    rule: 'a slide with no words and a page with none',
    slides: [null, VERSE],
    pdf: pdfOf(VERSE, null),
    shifted: false,
  },
  { rule: 'no page with words', slides: [VERSE, CHORUS], pdf: pdfOf(null, null), shifted: false },
  {
    rule: 'a skipped slide’s words on a page of the shown slides',
    slides: [VERSE, { skipped: CHORUS }, VERSE_TWO],
    pdf: pdfOf(CHORUS, VERSE_TWO),
    shifted: false,
  },
  {
    rule: 'a PDF of every slide, the skipped one in its place',
    slides: [VERSE, { skipped: CHORUS }, VERSE_TWO],
    pdf: pdfOf(VERSE, CHORUS, VERSE_TWO),
    shifted: false,
  },
];

/*
 * A shift needs two distinct pages whose words are another slide's alone, neither holding the other's.
 * Pages without words, words on two slides, and slides built line by line keep the count match.
 */
it.each(COPY_CASES)('Keynote’s two copies: $rule', ({ slides: copy, pdf, shifted }) => {
  const read = copy.map((words) =>
    words !== null && typeof words === 'object' ? slideOf(words.skipped, true) : slideOf(words),
  );
  expect(keynotePagesShifted(read, pdf)).toBe(shifted);
});

it('reads no words from a slide of more than 4,096 characters, so it names nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'drashti-keynote-long-words-'));
  try {
    const file = join(root, 'Placeholder long words.pptx');
    const long = `Placeholder ${'long words '.repeat(400)}`;
    writeFileSync(
      file,
      makeTestPptx([
        { text: long.slice(0, MAX_PAGE_TEXT - 10).trim(), color: '204060' },
        { text: long, color: '204060' },
      ]),
    );
    const [kept, tooLong] = await readPptx(file, true);
    expect(kept?.pageText?.length).toBeGreaterThan(4000);
    expect(tooLong?.pageText).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.each(['matched', 'uncertain', 'shifted', 'shifted without notes', 'mismatched', 'no export'] as const)(
  'keeps the editable Keynote source with the correct page order (%s)',
  async (kind) => {
    const root = mkdtempSync(join(tmpdir(), 'drashti-keynote-source-import-'));
    const source = join(root, 'Placeholder Keynote.key');
    const shifted = kind === 'shifted' || kind === 'shifted without notes';
    const words = shifted ? [last, first] : [first, last];
    const pdfNotes =
      kind === 'shifted'
        ? ['Placeholder last PDF-order notes', 'Placeholder first PDF-order notes']
        : undefined;
    const total = kind === 'mismatched' ? 1 : words.length;
    const pdf = makeTestPdf(words.slice(0, total).map(page));
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
        return Promise.resolve({ ok: true, pdf: picture, slides, shownOnly: false, editablePptx, pdfNotes });
      });
      const media = new MediaStore(db, { dir: mediaDir, freeBytes: () => 1024 ** 4 });
      const written: string[] = [];
      const logged: string[] = [];
      const result = await runImport({
        db,
        media,
        runId: randomUUID(),
        paths: [source],
        options: {},
        baker: false,
        tempDir: root,
        log: (line) => logged.push(line),
        onWrote: ({ presentationId }) => written.push(presentationId),
        drawPdf: (_input, outDir) => {
          mkdirSync(outDir, { recursive: true });
          const pages = Array.from({ length: total }, (_, index) => {
            const file = join(outDir, 'placeholder-' + String(index) + '.png');
            writeFileSync(file, editablePicture());
            return {
              index,
              file,
              notes: shifted ? 'Placeholder PDF comments' : '',
              pageText: kind === 'uncertain' ? 'Placeholder slide' : words[index],
            };
          });
          return Promise.resolve({ ok: true, width: 960, height: 540, pages, total, failed: [] });
        },
      });

      expect(result.totals).toMatchObject({ imported: 1, failed: 0 });
      expect(convert).toHaveBeenCalledTimes(1);
      // The log says which page set the copy aside, and whose words it has (C15's review, L6): the only trail of a
      // false mismatch. The PDF's first page has the words of the copy's third slide (its second is skipped).
      expect
        .soft(logged.filter((line) => line.includes('PowerPoint copy')))
        .toEqual(shifted ? [KEYNOTE_COPY_SET_ASIDE] : []);
      // What does not hang on the pages' order is said however the copy turned out: its skipped slide, left out of
      // the PDF, and its slide with builds (C15's review, L2).
      const issues = new ImportRepo(db).report(result.id)?.items[0]?.issues ?? [];
      expect
        .soft(issues.find((issue) => issue.code === 'pictures-hidden')?.message)
        .toBe(
          kind === 'mismatched' || kind === 'no export'
            ? undefined
            : '1 slide is hidden in the file and left out, as in its slide show.',
        );
      expect
        .soft(issues.find((issue) => issue.code === 'pictures-animations')?.message)
        .toBe('1 slide has builds: it shows its finished picture, all at once.');
      const hasFontNotice = new ImportRepo(db)
        .report(result.id)
        ?.items[0]?.issues.some(
          (issue) =>
            issue.code === 'legacy-font' &&
            issue.fix?.kind === 'convert-font' &&
            issue.fix.font === 'Kruti Dev 010',
        );
      expect(hasFontNotice).toBe(kind !== 'no export');
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

      if (kind !== 'matched' && kind !== 'uncertain') {
        expect(refs?.map((ref) => [ref?.ext, ref?.page])).toEqual(
          kind === 'mismatched'
            ? [['pdf', 0]]
            : [
                ['pdf', 0],
                ['pdf', 1],
              ],
        );
        expect(records.some((record) => record.ext === 'pptx')).toBe(false);
        if (shifted) {
          expect
            .soft(stored?.slides.map((slide) => slide.notes))
            .toEqual(pdfNotes ?? ['Placeholder PDF comments', 'Placeholder PDF comments']);
          const notice = new ImportRepo(db)
            .report(result.id)
            ?.items[0]?.issues.find((issue) => issue.code === 'keynote-copy-left-out');
          expect(notice?.message).toContain('export the deck from Keynote as PowerPoint');
          expect(notice?.message.includes('speaker notes were left out')).toBe(pdfNotes === undefined);
        }
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
      expect((await readPptx(editable, true)).map((slide) => slide.pageText)).toEqual([
        first,
        'Placeholder skipped slide',
        last,
      ]);
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

it('sets Keynote’s movie aside when its PDF’s pages are in another order than its copy’s slides, and says why', async () => {
  // Keynote made the deck's movie, its PowerPoint copy and its PDF (bakeDeck stands in for it, as on a Mac with
  // Keynote): the PDF's two pages come in the order last, first. The slides that come in as their pictures cannot be
  // matched to the PDF's pages, so the movie is set aside after it was made (deck-flow.ts, pagesOfShown), and the
  // deck comes in as its pictures (C15's review, L1).
  const root = mkdtempSync(join(tmpdir(), 'drashti-keynote-movie-shifted-'));
  const source = join(root, 'Placeholder Keynote.key');
  const mediaDir = join(root, 'Media');
  mkdirSync(mediaDir);
  writeFileSync(source, key);
  const db = openDatabase(join(root, 'drashti.sqlite'));
  const video: PptxMedia = {
    kind: 'video',
    shapeId: '4',
    name: 'Placeholder video',
    part: 'ppt/media/media1.mp4',
    link: null,
    box: { x: 0, y: 0, w: 1, h: 1 },
    poster: null,
    trim: null,
    fadeInMs: 0,
    fadeOutMs: 0,
    volume: 1,
    muted: false,
    loop: false,
    start: { group: 0, offsetMs: 0 },
    acrossSlides: null,
    hideWhenStopped: false,
    enterGroup: null,
    exitGroup: null,
  };
  const still = { transition: null, groups: [], media: [], triggers: 0 };
  const deck: PptxDeck = {
    size: { cx: 12_192_000, cy: 6_858_000 },
    slides: slides.map((slide, index) => ({
      ...slide,
      deck: index === 0 ? { ...still, media: [video] } : still,
    })),
  };
  const made = vi.spyOn(bake, 'bakeDeck').mockImplementationOnce(async (baker, { work }, options) => {
    const deckFile = join(work, 'keynote.pptx');
    writeFileSync(deckFile, pptx);
    const pdf = join(work, 'pictures.pdf');
    writeFileSync(pdf, makeTestPdf([last, first].map(page)));
    // As Keynote's bake does: the slides as their pictures as soon as its PDF is saved.
    await options.pdfReady?.(pdf, deck);
    return {
      ok: true,
      pdf,
      baked: {
        baker,
        deckFile,
        deck,
        plan: { baker, settleMs: 0, slides: [] },
        cuts: {
          slides: [],
          offsets: [],
          lostSlides: [],
          offSlides: [],
          lengthOff: false,
          lengths: { movieMs: 0, plannedMs: 0 },
          worst: null,
        },
        files: [],
        bakeMs: 0,
        movie: { width: 960, height: 540, fps: 30, durationMs: 0 },
        keynoteMedia: [],
        // The first slide (its video) went through the movie; the last comes in as its picture.
        choice: { moving: new Set([0]), leadIns: new Set<number>(), pictures: new Set([2]) },
      },
    };
  });
  const drawn: string[] = [];
  try {
    const media = new MediaStore(db, { dir: mediaDir, freeBytes: () => 1024 ** 4 });
    const written: string[] = [];
    const logged: string[] = [];
    const result = await runImport({
      db,
      media,
      runId: randomUUID(),
      paths: [source],
      options: {},
      ffmpeg: join(root, 'placeholder-ffmpeg'),
      tempDir: root,
      log: (line) => logged.push(line),
      onWrote: ({ presentationId }) => written.push(presentationId),
      drawPdf: (pdf, outDir) => {
        drawn.push(pdf);
        mkdirSync(outDir, { recursive: true });
        const pages = [last, first].map((pageText, index) => {
          const file = join(outDir, 'placeholder-' + String(index) + '.png');
          writeFileSync(file, editablePicture());
          return { index, file, notes: '', pageText };
        });
        return Promise.resolve({ ok: true, width: 960, height: 540, pages, total: 2, failed: [] });
      },
    });

    expect(made).toHaveBeenCalledOnce();
    expect(made.mock.calls[0]?.[0]).toBe('keynote');
    expect(convert).not.toHaveBeenCalled();
    // Its PDF drawn once, as the movie was made; no slides written before the movie was set aside, then the deck.
    expect(drawn).toHaveLength(1);
    expect(written).toHaveLength(1);
    expect(result.totals).toMatchObject({ imported: 1, failed: 0 });
    const issues = new ImportRepo(db).report(result.id)?.items[0]?.issues ?? [];
    const said = (code: string) => issues.find((issue) => issue.code === code)?.message;
    expect(said('deck-pictures')).toBe(
      'Keynote made the deck’s movie, but it could not be cut into its steps (its PDF’s pages did not match its slides one for one): its slides came in as pictures, without their animations.',
    );
    expect(said('keynote-copy-left-out')).toBe(
      'Keynote’s PDF and PowerPoint copy have different page orders, so Edit slides uses the PDF. The deck’s speaker notes were left out. To edit from PowerPoint, export the deck from Keynote as PowerPoint and import that file.',
    );
    // Its video was on the copy's first slide, which is the PDF's second page: it says so (C15's review, L1).
    expect
      .soft(said('deck-media-unmatched'))
      .toBe(
        'Its video or sound was left out: its pictures could not be matched to its slides one for one (the PDF’s pages are in a different order than its slides).',
      );
    expect
      .soft(said('pictures-hidden'))
      .toBe('1 slide is hidden in the file and left out, as in its slide show.');
    expect
      .soft(said('pictures-animations'))
      .toBe('1 slide has builds: it shows its finished picture, all at once.');
    expect.soft(logged.filter((line) => line.includes('PowerPoint copy'))).toEqual([KEYNOTE_COPY_SET_ASIDE]);
    const stored = new PresentationRepo(db).content(written[0] ?? '');
    expect(
      stored?.slides.map((slide) => {
        const ref = documentPageFromJson(slide.document_page);
        return [ref?.ext, ref?.page];
      }),
    ).toEqual([
      ['pdf', 0],
      ['pdf', 1],
    ]);
    expect(new OriginalsStore(db, mediaDir).list().some((original) => original.ext === 'pptx')).toBe(false);
  } finally {
    made.mockRestore();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

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
    expect(new ImportRepo(db).report(result.id)?.items[0]?.issues).toContainEqual(
      expect.objectContaining({ code: 'legacy-font', fix: { kind: 'convert-font', font: 'Kruti Dev 010' } }),
    );
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
