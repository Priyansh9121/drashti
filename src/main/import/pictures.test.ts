import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { PicturesResult } from '../../shared/pictures';
import { fitPage, tidyNotes } from '../../shared/pictures';
import { openDatabase } from '../db/database';
import { ImportRepo } from '../db/imports';
import { PresentationRepo } from '../db/presentations';
import { MediaStore } from './media-store';
import {
  converterFor,
  noConverterMessage,
  notesForPages,
  picturesIssues,
  picturesPresentation,
  readPptx,
} from './pictures';
import { runImport } from './pipeline';
import { makeTestPdf } from './testing/make-pdf';
import { makeTestPptx } from './testing/make-pptx';

/*
 * PDF, PowerPoint and Keynote as pictures (Session 15): what the import worker
 * makes of a document. The drawing itself (pdf.js in a window) is the main
 * process's and is tested end to end (tests/e2e/pictures.spec.ts); here a
 * stand-in draws each page as a small PNG.
 */

/** A tiny PNG of one colour. */
function png(rgb: [number, number, number], width = 4, height = 3): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('a PowerPoint file read for its slides', () => {
  it('gives each slide its notes, whether it is hidden, and whether it has animations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-pptx-'));
    const file = join(dir, 'Placeholder deck.pptx');
    writeFileSync(
      file,
      makeTestPptx([
        { color: '1E3A8A', text: 'Placeholder one', notes: 'Placeholder note one\nSecond line' },
        { color: '7F1D1D', text: 'Placeholder two', hidden: true, notes: 'Hidden placeholder note' },
        { color: '14532D', text: 'Placeholder three', animated: true },
      ]),
    );
    expect(await readPptx(file)).toEqual([
      { hidden: false, notes: 'Placeholder note one\nSecond line', animated: false },
      { hidden: true, notes: 'Hidden placeholder note', animated: false },
      { hidden: false, notes: '', animated: true },
    ]);
  });

  it('refuses a file that is not one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-pptx-'));
    const file = join(dir, 'Not a deck.pptx');
    writeFileSync(file, 'placeholder text, not a zip');
    await expect(readPptx(file)).rejects.toThrow();
  });
});

describe('notes for the pages of a PDF', () => {
  const slides = [
    { hidden: false, notes: 'a', animated: false },
    { hidden: true, notes: 'hidden', animated: false },
    { hidden: false, notes: 'c', animated: false },
  ];
  it('match the shown slides when the PDF left the hidden one out, or every slide when it kept it', () => {
    expect(notesForPages(slides, 2)).toEqual(['a', 'c']);
    expect(notesForPages(slides, 3)).toEqual(['a', 'hidden', 'c']);
  });
  it('are not guessed when the pages do not match', () => {
    expect(notesForPages(slides, 5)).toBeNull();
  });
});

describe('what saves a file as PDF', () => {
  const all = { keynote: true, powerpoint: true };
  it('is Keynote on a Mac, PowerPoint otherwise, and nothing for a PDF', () => {
    expect(converterFor('pdf', 'darwin', all)).toBeNull();
    expect(converterFor('pptx', 'darwin', all)).toBe('keynote');
    expect(converterFor('pptx', 'darwin', { keynote: false, powerpoint: true })).toBe('powerpoint');
    expect(converterFor('ppt', 'win32', { keynote: false, powerpoint: true })).toBe('powerpoint');
    expect(converterFor('pptx', 'linux', all)).toBeNull();
  });
  it('needs Keynote for a Keynote file', () => {
    expect(converterFor('key', 'darwin', { keynote: false, powerpoint: true })).toBeNull();
    expect(converterFor('key', 'win32', { keynote: false, powerpoint: true })).toBeNull();
  });
  it('says plainly to save it as PDF when there is nothing', () => {
    expect(noConverterMessage('pptx')).toContain('Save As, PDF');
    expect(noConverterMessage('key')).toContain('Export To > PDF');
  });
});

describe('the slides a document makes', () => {
  it('hold each page as a picture over the whole slide, with the notes', () => {
    const p = picturesPresentation(
      '/decks/Placeholder deck.pdf',
      {
        width: 1920,
        height: 1080,
        pages: [
          { index: 0, file: '/tmp/page-0001.png', notes: 'a comment' },
          { index: 1, file: '/tmp/page-0002.png', notes: '' },
        ],
      },
      ['', 'Slide notes'],
    );
    expect(p.name).toBe('Placeholder deck');
    expect(p.width).toBe(1920);
    const slides = p.groups.flatMap((g) => g.slides);
    expect(slides.map((s) => s.notes)).toEqual(['a comment', 'Slide notes']);
    expect(slides[0]?.elements).toEqual([
      {
        id: 'picture',
        kind: 'image',
        frame: { x: 0, y: 0, width: 1920, height: 1080 },
        mediaId: 'media-ref:0',
        fit: 'fit',
      },
    ]);
    expect(p.media).toEqual([
      { originalPath: '/tmp/page-0001.png', kind: 'image' },
      { originalPath: '/tmp/page-0002.png', kind: 'image' },
    ]);
  });

  it('come with a report saying what became of the file', () => {
    const issues = picturesIssues({
      source: 'pptx',
      converter: 'keynote',
      pages: 3,
      total: 4,
      failed: [3],
      withNotes: 2,
      animated: 1,
      notesUnmatched: false,
    });
    const text = issues.map((i) => i.message).join('\n');
    expect(text).toContain('Each of the 3 page(s) became a slide');
    expect(text).toContain('Animations and builds show as each slide’s finished picture');
    expect(text).toContain('Keynote saved it as PDF first');
    expect(text).toContain('1 slide(s) had animations');
    expect(text).toContain('2 slide(s) have speaker notes');
    expect(text).toContain('Page(s) 4 could not be drawn');
  });
});

describe('fitting a page and tidying notes', () => {
  it('fits a 4:3 page into 16:9 with black either side', () => {
    expect(fitPage(720, 540, 1920, 1080)).toEqual({ scale: 2, x: 240, y: 0, w: 1440, h: 1080 });
    expect(fitPage(960, 540, 1920, 1080)).toEqual({ scale: 2, x: 0, y: 0, w: 1920, h: 1080 });
  });
  it('trims lines and runs of blank lines', () => {
    expect(tidyNotes('  one \r\n\r\n\r\n two  ')).toBe('one\n\ntwo');
  });
});

describe('a test PDF', () => {
  it('is a PDF whose cross-reference table points at each object', () => {
    const pdf = makeTestPdf([
      { width: 960, height: 540, color: [30, 58, 138], text: 'Placeholder', note: 'Placeholder note' },
      { width: 720, height: 540, color: [127, 29, 29] },
    ]);
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    const xref = Number(/startxref\n(\d+)/u.exec(text)?.[1]);
    const rows = text.slice(xref).split('\n').slice(3);
    rows.slice(0, 5).forEach((row, i) => {
      const at = Number(row.slice(0, 10));
      expect(text.slice(at, at + 12)).toContain(`${String(i + 1)} 0 obj`);
    });
  });
});

describe('importing a document as pictures', () => {
  function setup(drawn: (pdf: string, outDir: string) => PicturesResult) {
    const dir = mkdtempSync(join(tmpdir(), 'drashti-pictures-'));
    const mediaDir = join(dir, 'Media');
    mkdirSync(mediaDir);
    const db = openDatabase(join(dir, 'drashti.sqlite'));
    const media = new MediaStore(db, { dir: mediaDir, freeBytes: () => 1024 ** 4 });
    const asked: string[] = [];
    const run = (paths: string[], converters = false) =>
      runImport({
        db,
        media,
        runId: randomUUID(),
        paths,
        options: {},
        progressEveryMs: 0,
        converters,
        drawPdf: (pdf, outDir) => {
          asked.push(pdf);
          mkdirSync(outDir, { recursive: true });
          return Promise.resolve(drawn(pdf, outDir));
        },
      });
    return { dir, db, run, asked, report: (id: string) => new ImportRepo(db).report(id) };
  }

  /** The stand-in drawer: three pages of three colours, the second with a comment. */
  const threePages = (_pdf: string, outDir: string): PicturesResult => {
    const colours: [number, number, number][] = [
      [30, 58, 138],
      [127, 29, 29],
      [20, 83, 45],
    ];
    const pages = colours.map((c, index) => {
      const file = join(outDir, `page-${String(index + 1)}.png`);
      writeFileSync(file, png(c));
      return { index, file, notes: index === 1 ? 'Placeholder comment' : '' };
    });
    return { ok: true, width: 1920, height: 1080, pages, total: 3, failed: [] };
  };

  it('makes a presentation of pictures, one slide per page, known again when imported again', async () => {
    const t = setup(threePages);
    const pdf = join(t.dir, 'Placeholder slides.pdf');
    writeFileSync(pdf, makeTestPdf([{ width: 960, height: 540, color: [0, 0, 0] }]));
    const first = await t.run([pdf]);
    expect(first.totals).toMatchObject({ imported: 1, failed: 0, presentations: 1, slides: 3, media: 3 });
    const item = t.report(first.id)?.items[0];
    expect(item).toMatchObject({ format: 'pictures', outcome: 'imported', name: 'Placeholder slides' });
    expect(item?.issues.map((i) => i.code)).toEqual(['pictures', 'pictures-notes']);
    const presentations = new PresentationRepo(t.db);
    const doc = presentations.get(item?.target?.id ?? '');
    expect(doc?.source).toMatchObject({ kind: 'pictures', path: pdf });
    const slides = doc?.groups.flatMap((g) => g.slides) ?? [];
    expect(slides.map((s) => s.notes)).toEqual(['', 'Placeholder comment', '']);
    // Each slide holds one picture over the whole slide.
    expect(t.db.prepare('SELECT kind, x, y, width, height FROM elements').all()).toEqual(
      [1, 2, 3].map(() => ({ kind: 'image', x: 0, y: 0, width: 1920, height: 1080 })),
    );
    // The pictures are Drashti's own media, from the document's pages.
    const sources = t.db.prepare('SELECT source_kind, source_path FROM media ORDER BY source_path').all();
    expect(sources).toEqual(
      [1, 2, 3].map((n) => ({ source_kind: 'drashti', source_path: `${pdf}#page=${String(n)}` })),
    );
    // The same file again is known, and not drawn again.
    const again = await t.run([pdf]);
    expect(again.totals).toMatchObject({ skipped: 1, imported: 0 });
    expect(t.asked).toHaveLength(1);
  });

  it('says plainly to save a PowerPoint file as PDF when nothing here can', async () => {
    const t = setup(threePages);
    const deck = join(t.dir, 'Placeholder deck.pptx');
    writeFileSync(deck, makeTestPptx([{ color: '1E3A8A', text: 'Placeholder' }]));
    const run = await t.run([deck], false);
    expect(run.totals).toMatchObject({ failed: 1, imported: 0 });
    const item = t.report(run.id)?.items[0];
    expect(item?.format).toBe('pictures');
    expect(item?.message).toContain('Save As, PDF');
    expect(t.asked).toHaveLength(0);
  });

  it('says why when the PDF cannot be drawn', async () => {
    const t = setup(() => ({ ok: false, message: 'The PDF is protected with a password.' }));
    const pdf = join(t.dir, 'Placeholder locked.pdf');
    writeFileSync(pdf, makeTestPdf([{ width: 960, height: 540, color: [0, 0, 0] }]));
    const run = await t.run([pdf]);
    expect(run.totals).toMatchObject({ failed: 1 });
    expect(t.report(run.id)?.items[0]?.message).toContain('password');
  });
});
