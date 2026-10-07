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
import { checkDeck, convertersFor, noConverterMessage } from './deck-converters';
import { MediaStore } from './media-store';
import { notesForPages, picturesIssues, picturesPresentation, readPptx } from './pictures';
import { runImport } from './pipeline';
import { scanPaths } from './scan';
import { makeTestPdf } from './testing/make-pdf';
import { makeTestPptx } from './testing/make-pptx';
import { makeZip } from './testing/zip-writer';

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
  it('is PowerPoint for its own files, then Keynote on a Mac, and nothing for a PDF', () => {
    expect(convertersFor('pdf', 'darwin', all)).toEqual([]);
    expect(convertersFor('pptx', 'darwin', all)).toEqual(['powerpoint', 'keynote']);
    expect(convertersFor('pptx', 'darwin', { keynote: true, powerpoint: false })).toEqual(['keynote']);
    expect(convertersFor('ppt', 'win32', all)).toEqual(['powerpoint']);
    expect(convertersFor('pptx', 'linux', all)).toEqual([]);
  });
  it('needs Keynote for a Keynote file', () => {
    expect(convertersFor('key', 'darwin', all)).toEqual(['keynote']);
    expect(convertersFor('key', 'darwin', { keynote: false, powerpoint: true })).toEqual([]);
    expect(convertersFor('key', 'win32', all)).toEqual([]);
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
      converter: 'powerpoint',
      pages: 3,
      total: 4,
      failed: [3],
      withNotes: 2,
      animated: 1,
      hidden: 1,
      notesUnmatched: false,
    });
    const text = issues.map((i) => i.message).join('\n');
    expect(text).toContain('Each of the 3 pages became a slide holding its picture');
    expect(text).toContain('Animations and builds show as each slide’s finished picture');
    expect(text).toContain('PowerPoint saved it as PDF first');
    expect(text).toContain('1 slide has animations: it shows its finished picture');
    expect(text).toContain('1 slide is hidden in the file and left out, as in its slide show');
    expect(text).toContain('2 slides have speaker notes');
    expect(text).toContain('Page 4 could not be drawn and was left out');
  });

  it('say when one app could not and another did, and call a Keynote file’s animations builds', () => {
    const issues = picturesIssues({
      source: 'key',
      converter: 'keynote',
      firstTried: { converter: 'powerpoint', reason: 'PowerPoint stopped answering' },
      pages: 1,
      total: 1,
      failed: [],
      withNotes: 1,
      animated: 2,
      notesUnmatched: false,
    });
    expect(issues.find((i) => i.code === 'pictures-converter')).toMatchObject({
      severity: 'warning',
      message:
        'PowerPoint could not save it as PDF (PowerPoint stopped answering), so Keynote did. Check the pictures look right.',
    });
    const text = issues.map((i) => i.message).join('\n');
    expect(text).toContain('The page became a slide holding its picture');
    expect(text).toContain('2 slides have builds: each shows its finished picture');
    expect(text).toContain('1 slide has speaker notes');
    expect(text).not.toContain('hidden');
  });
});

describe('a deck checked before an app is asked to open it (Session 16)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-decks-'));
  const write = (name: string, data: Buffer | string) => {
    const path = join(dir, name);
    writeFileSync(path, data);
    return path;
  };

  it('passes a good PowerPoint file, with its slides', async () => {
    const deck = write(
      'Good.pptx',
      makeTestPptx([{ color: '1E3A8A', text: 'Placeholder', notes: 'A note' }]),
    );
    const checked = await checkDeck('pptx', deck);
    expect(checked).toMatchObject({ ok: true, slides: [{ notes: 'A note', hidden: false }] });
  });

  it('refuses a damaged PowerPoint file, which PowerPoint would ask about where nobody sees', async () => {
    const whole = makeTestPptx([{ color: '1E3A8A', text: 'Placeholder' }]);
    const cut = await checkDeck('pptx', write('Cut.pptx', whole.subarray(0, 600)));
    expect(cut.ok ? '' : cut.message).toContain('This file looks damaged (Not a ZIP archive');
    const broken = await checkDeck(
      'pptx',
      write(
        'Broken.pptx',
        makeZip([{ name: 'ppt/presentation.xml', data: '<?xml version="1.0"?><p:presentation><broken' }]),
      ),
    );
    expect(broken.ok ? '' : broken.message).toContain('If it opens in PowerPoint, save it again there');
  });

  it('knows an old PowerPoint file and a Keynote file by what is inside', async () => {
    const ole = Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(504)]);
    expect((await checkDeck('ppt', write('Old.ppt', ole))).ok).toBe(true);
    expect((await checkDeck('ppt', write('Renamed.ppt', 'not a deck'))).ok).toBe(false);
    const key = makeZip([{ name: 'Index/Document.iwa', data: Buffer.alloc(16) }]);
    expect((await checkDeck('key', write('Good.key', key))).ok).toBe(true);
    const empty = await checkDeck('key', write('Empty.key', makeZip([{ name: 'preview.jpg', data: 'x' }])));
    expect(empty.ok ? '' : empty.message).toContain('it has no Keynote document inside');
    expect((await checkDeck('key', write('Junk.key', 'junk'))).ok).toBe(false);
  });

  it('takes a Keynote file saved as a package (a folder) as one item, never its pictures', async () => {
    const pkg = join(dir, 'Folder', 'Placeholder package.key');
    mkdirSync(join(pkg, 'Data'), { recursive: true });
    writeFileSync(join(pkg, 'Data', 'image.png'), png([0, 0, 0]));
    writeFileSync(join(pkg, 'preview.jpg'), 'x');
    const found = await scanPaths([join(dir, 'Folder')]);
    expect(found.files.map((f) => [f.path, f.format])).toEqual([[pkg, 'pictures']]);
    expect((await scanPaths([pkg])).files.map((f) => f.format)).toEqual(['pictures']);
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

  it('refuses a damaged PowerPoint file at once, and a Keynote package with what to do', async () => {
    const t = setup(threePages);
    const deck = join(t.dir, 'Placeholder damaged.pptx');
    writeFileSync(deck, makeTestPptx([{ color: '1E3A8A', text: 'Placeholder' }]).subarray(0, 900));
    const pkg = join(t.dir, 'Placeholder package.key');
    mkdirSync(join(pkg, 'Index'), { recursive: true });
    writeFileSync(join(pkg, 'Index', 'Document.iwa'), 'x');
    // Converters allowed: neither file may reach Keynote or PowerPoint.
    const run = await t.run([deck, pkg], true);
    expect(run.totals).toMatchObject({ failed: 2, imported: 0 });
    const items = t.report(run.id)?.items ?? [];
    expect(items.find((i) => i.sourcePath === deck)?.issues.map((i) => i.code)).toEqual(['pictures-damaged']);
    expect(items.find((i) => i.sourcePath === pkg)?.message).toContain(
      'File > Advanced > Change File Type > Single File',
    );
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
