import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { PresentationDoc } from '../../shared/library';
import { isPhoneDeck } from '../../shared/phone-decks';
import type { PicturesResult } from '../../shared/pictures';
import { readShastraFile } from '../../shared/shastra';
import { FIT_EVERYWHERE } from '../../shared/shastra-slides';
import { DEFAULT_THEME } from '../../shared/themes';
import { openDatabase } from '../db/database';
import { ImportRepo } from '../db/imports';
import { PresentationRepo } from '../db/presentations';
import { ShastraRepo } from '../db/shastra';
import type * as Converters from '../import/deck-converters';
import { MediaStore } from '../import/media-store';
import { runImport } from '../import/pipeline';
import { editablePicture } from '../import/testing/editable-pptx-fixture';
import { bundleLibrary } from '../import/testing/kirtan-bundle-fixture';
import { makeTestPdf } from '../import/testing/make-pdf';
import { makeTestPptx } from '../import/testing/make-pptx';
import { cocoaRtf, pp6Presentation } from '../import/testing/pp6-fixtures';
import { ShastraService } from '../shastra/shastra-service';

/*
 * What a phone may put up (alpha.23, QA23-PHONE-1, the owner's "Only PPT and PDF"), checked against what the imports
 * really make of the repo's fixtures: a PowerPoint deck and a PDF are decks; a kirtan, a ProPresenter song, a Shastra
 * passage and a presentation of words are not. Generated files and placeholder words only.
 */

// A PowerPoint file is saved as PDF by PowerPoint here (a stand-in: no app runs), as still-pptx-pipeline.test.ts does.
const convert = vi.hoisted(() => vi.fn<typeof Converters.convertToPdf>());
vi.mock('../import/deck-converters', async (original) => {
  const actual = await original<typeof Converters>();
  return {
    ...actual,
    findConverters: () => Promise.resolve({ keynote: false, powerpoint: true }),
    // Linux's unit runner takes the same PowerPoint choice as a supported host.
    convertersFor: (
      source: Parameters<typeof Converters.convertersFor>[0],
      platform: NodeJS.Platform,
      has: Converters.Converters,
    ) => actual.convertersFor(source, platform === 'linux' ? 'win32' : platform, has),
    convertToPdf: convert,
  };
});

const root = mkdtempSync(join(tmpdir(), 'drashti-phone-decks-'));
const db = openDatabase(join(root, 'drashti.sqlite'));
const media = new MediaStore(db, { dir: join(root, 'Media'), freeBytes: () => 1024 ** 4 });
afterAll(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

/** The stand-in for pdf.js: one page drawn, a generated picture. */
const draw = (_pdf: string, outDir: string): Promise<PicturesResult> => {
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, 'placeholder-page.png');
  writeFileSync(file, editablePicture());
  return Promise.resolve({
    ok: true,
    width: 960,
    height: 540,
    pages: [{ index: 0, file, notes: '' }],
    total: 1,
    failed: [],
  });
};

/** A file imported as Drashti imports it, and the presentation it made, read back as Main reads it. */
async function imported(name: string, data: string | Buffer): Promise<PresentationDoc> {
  const path = join(root, name);
  writeFileSync(path, data);
  const run = await runImport({
    db,
    media,
    runId: randomUUID(),
    paths: [path],
    options: {},
    progressEveryMs: 0,
    converters: true,
    baker: false,
    drawPdf: draw,
  });
  const item = new ImportRepo(db).report(run.id)?.items[0];
  expect(item?.outcome, name).toBe('imported');
  const doc = new PresentationRepo(db).get(item?.target?.id ?? '');
  if (!doc) throw new Error(`${name} made no presentation`);
  return doc;
}

function passage(): PresentationDoc {
  const repo = new ShastraRepo(openDatabase(':memory:'));
  const read = readShastraFile({
    format: 'drashti-shastra',
    version: 1,
    name: 'Placeholder Granth',
    abbreviation: 'PG',
    items: [1, 2].map((n) => ({ number: n, text: { en: `Placeholder ${String(n)}.` } })),
  });
  if (!read.ok) throw new Error(read.message);
  repo.load(read.text, { path: null, hash: 'h' }, 'plain');
  const doc = new ShastraService({ repo, theme: () => DEFAULT_THEME, targets: () => FIT_EVERYWHERE }).doc(
    'shastra:pg#1-2',
  );
  if (!doc) throw new Error('No passage');
  return doc;
}

describe('a PowerPoint or a PDF, as a phone may put it up (QA23-PHONE-1)', () => {
  it('is a PDF imported, and a PowerPoint deck imported', async () => {
    const pdf = await imported(
      'Placeholder slides.pdf',
      makeTestPdf([{ width: 960, height: 540, color: [0, 0, 0] }]),
    );
    expect(pdf.source?.kind).toBe('pictures');
    expect(isPhoneDeck(pdf)).toBe(true);
    convert.mockImplementation((_app, _deck, work) => {
      const out = join(work, 'Placeholder conversion.pdf');
      writeFileSync(out, makeTestPdf([{ width: 960, height: 540, color: [0, 0, 0] }]));
      return Promise.resolve({ ok: true, pdf: out, slides: null, shownOnly: false });
    });
    const deck = await imported(
      'Placeholder deck.pptx',
      makeTestPptx([{ color: '204060', text: 'Placeholder words' }]),
    );
    expect(convert).toHaveBeenCalledTimes(1);
    expect(isPhoneDeck(deck)).toBe(true);
  });

  it('is a deck’s slide with its clicks wherever it came from, but never as a passage or Repeat Slides', async () => {
    const pdf = await imported(
      'Placeholder clicks.pdf',
      // Its own bytes: the same file again would be known, and skipped.
      makeTestPdf([{ width: 960, height: 540, color: [20, 40, 60] }]),
    );
    const [group] = pdf.groups;
    const [first] = group?.slides ?? [];
    if (!group || !first) throw new Error('No slide');
    // Brought in from a Drashti file (its source not the document's), a slide still holding the deck's clicks.
    const clicks: PresentationDoc = {
      ...pdf,
      source: { kind: 'drashti', path: null, ref: null, importedAt: null },
      groups: [
        {
          ...group,
          slides: [{ ...first, slide: { ...first.slide, deck: { steps: [], media: [] } } }],
        },
      ],
    };
    expect(isPhoneDeck(clicks)).toBe(true);
    // Repeat Slides' steps of a deck's slides, and a passage, go round or come from a text: never a phone's.
    expect(isPhoneDeck({ ...clicks, repeat: { playlistId: 'placeholder-repeat' } })).toBe(false);
    expect(isPhoneDeck({ ...pdf, repeat: { playlistId: 'placeholder-repeat' } })).toBe(false);
  });

  it('is never a kirtan, a ProPresenter song, a Shastra passage or a presentation of words', async () => {
    const kirtans = await bundleLibrary();
    const kirtan = kirtans.repo.get(kirtans.id);
    expect(kirtan?.kirtan?.category).toBe('Kirtan');
    expect(isPhoneDeck(kirtan)).toBe(false);
    const song = await imported(
      'Placeholder Hymn.pro6',
      pp6Presentation({
        uuid: 'PHONE-HYMN',
        groups: [
          {
            name: 'Verse',
            slides: [{ text: [{ rtf: cocoaRtf([['Placeholder line', 72, [255, 255, 255]]]) }] }],
          },
        ],
      }),
    );
    expect(song.source?.kind).toBe('pp6');
    expect(isPhoneDeck(song)).toBe(false);
    const words = await imported(
      'Placeholder Song One.txt',
      readFileSync(join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'lyrics', 'Placeholder Song One.txt')),
    );
    expect(words.source?.kind).toBe('text');
    expect(isPhoneDeck(words)).toBe(false);
    const read = passage();
    expect(read.passage?.reference).toBeTruthy();
    expect(isPhoneDeck(read)).toBe(false);
    expect(isPhoneDeck(null)).toBe(false);
  });
});
