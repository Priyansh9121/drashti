import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PicturesResult } from '../../shared/pictures';
import type { ReadWordsProgress } from '../../shared/read-words';
import { READ_WORDS_STOPPED } from '../../shared/read-words';
import type { ReadWordsDeps } from './read-words';
import { READING_PAGE, ReadWords } from './read-words';
import type { ReaderSays } from './reader-protocol';
import { isReaderSays } from './reader-protocol';

/*
 * Read Words from a Page… (book OCR, alpha.21), Main's side: what is chosen, a PDF's pages drawn first, the reading
 * process heard as it goes, Stop Reading, and what the operator is told. The dialog, the drawing and the reading
 * process are stand-ins here; the real ones are tested end to end (tests/e2e/read-words.spec.ts).
 */

type Said = (m: ReaderSays | { kind: 'gone' }) => void;

function setup(over: Partial<ReadWordsDeps> = {}) {
  const chosen: { files: string[] | null } = { files: null };
  const progress: (ReadWordsProgress | null)[] = [];
  const readers: { pages: string[]; said: Said; stopped: boolean }[] = [];
  const drawn: { pdf: string; outDir: string; pages: number[] }[] = [];
  const dirs: string[] = [];
  const log: string[] = [];
  let drawing: (pages: number[], signal: AbortSignal) => Promise<PicturesResult> = (pages) =>
    Promise.resolve({
      ok: true,
      width: READING_PAGE.width,
      height: READING_PAGE.height,
      pages: pages.map((index) => ({ index, file: `/drawn/page-${String(index + 1)}.png`, notes: '' })),
      total: 3,
      failed: [],
    });
  const words = new ReadWords({
    choose: () => Promise.resolve(chosen.files),
    drawPages: (pdf, outDir, pages, signal) => {
      drawn.push({ pdf, outDir, pages });
      return drawing(pages, signal);
    },
    startReader: (pages, said) => {
      const reader = { pages, said, stopped: false };
      readers.push(reader);
      return {
        stop: () => {
          reader.stopped = true;
        },
      };
    },
    tempDir: () => {
      const dir = mkdtempSync(join(tmpdir(), 'drashti-read-words-test-'));
      dirs.push(dir);
      return Promise.resolve(dir);
    },
    progress: (p) => progress.push(p),
    log: (line) => log.push(line),
    ...over,
  });
  const reader = async () => {
    for (let i = 0; i < 100 && readers.length === 0; i++) await new Promise((r) => setTimeout(r, 2));
    const r = readers.at(-1);
    if (!r) throw new Error('no reader started');
    return r;
  };
  return {
    words,
    chosen,
    progress,
    readers,
    reader,
    drawn,
    dirs,
    log,
    drawWith: (f: typeof drawing) => {
      drawing = f;
    },
  };
}

describe('choosing what to read', () => {
  it('nothing chosen: cancelled; pictures: their names in order (page 2 before page 10); one PDF: its name', async () => {
    const t = setup();
    expect(await t.words.choose()).toEqual({ ok: false, cancelled: true });
    t.chosen.files = ['/scans/Page 10.JPG', '/scans/Page 2.png', '/scans/Page 1.tiff'];
    expect(await t.words.choose()).toEqual({
      ok: true,
      kind: 'pictures',
      names: ['Page 1.tiff', 'Page 2.png', 'Page 10.JPG'],
    });
    t.chosen.files = ['/books/Placeholder book.PDF'];
    expect(await t.words.choose()).toEqual({ ok: true, kind: 'pdf', name: 'Placeholder book.PDF' });
  });

  it('refuses two PDFs, a PDF with pictures, files that are not pictures, and more than 20 pictures', async () => {
    const t = setup();
    t.chosen.files = ['/a.pdf', '/b.pdf'];
    expect(await t.words.choose()).toEqual({ ok: false, message: 'Choose one PDF at a time.' });
    t.chosen.files = ['/a.pdf', '/b.png'];
    expect(await t.words.choose()).toEqual({ ok: false, message: 'Choose one PDF at a time.' });
    t.chosen.files = ['/a.png', '/notes.txt'];
    expect(await t.words.choose()).toEqual({
      ok: false,
      message: 'Choose pictures (PNG, JPEG, TIFF, WebP, GIF or BMP) or one PDF.',
    });
    t.chosen.files = Array.from({ length: 21 }, (_, i) => `/scan-${String(i)}.png`);
    expect(await t.words.choose()).toEqual({ ok: false, message: 'Choose at most 20 pictures at once.' });
    // Nothing was chosen by any of them.
    expect(await t.words.read(null, null)).toEqual({
      ok: false,
      message: 'Choose the pages to read first: Read Words from a Page….',
    });
  });
});

describe('reading pictures', () => {
  it('reads them in order, says how far it has got, and gives their words a blank line apart', async () => {
    const t = setup();
    t.chosen.files = ['/scans/b.png', '/scans/a.png'];
    await t.words.choose();
    const reading = t.words.read(null, null);
    const r = await t.reader();
    expect(r.pages).toEqual(['/scans/a.png', '/scans/b.png']);
    r.said({ kind: 'starting', fraction: 0.5 });
    r.said({ kind: 'reading', page: 0, fraction: 0.5 });
    // A step smaller than a hundredth is not passed on.
    r.said({ kind: 'reading', page: 0, fraction: 0.501 });
    r.said({ kind: 'page', page: 0, text: 'પહેલું પાનું' });
    r.said({ kind: 'reading', page: 1, fraction: 0 });
    r.said({ kind: 'page', page: 1, text: 'બીજું પાનું' });
    r.said({ kind: 'done' });
    expect(await reading).toEqual({ ok: true, text: 'પહેલું પાનું\n\nબીજું પાનું', pages: 2 });
    expect(t.progress).toEqual([
      { stage: 'starting', page: 1, pages: 2, fraction: 0 },
      { stage: 'reading', page: 1, pages: 2, fraction: 0.25 },
      { stage: 'reading', page: 2, pages: 2, fraction: 0.5 },
      null,
    ]);
    expect(r.stopped).toBe(true);
    expect(t.log.at(-1)).toMatch(/^Read words: 2 page\(s\), \d+ characters, in \d+ ms$/u);
  });

  it('a page with no words is left out; none on any: it says so', async () => {
    const t = setup();
    t.chosen.files = ['/a.png', '/b.png'];
    await t.words.choose();
    let reading = t.words.read(null, null);
    let r = await t.reader();
    r.said({ kind: 'page', page: 0, text: '' });
    r.said({ kind: 'page', page: 1, text: 'શબ્દ' });
    r.said({ kind: 'done' });
    expect(await reading).toEqual({ ok: true, text: 'શબ્દ', pages: 2 });
    reading = t.words.read(null, null);
    for (let i = 0; i < 100 && t.readers.length < 2; i++) await new Promise((res) => setTimeout(res, 2));
    r = await t.reader();
    r.said({ kind: 'done' });
    expect(await reading).toEqual({
      ok: false,
      message: 'No words were found on these pages: choose clearer pictures of them.',
    });
  });

  it('a picture it cannot read, a reader that cannot start, and one that ends unexpectedly: said plainly', async () => {
    const t = setup();
    t.chosen.files = ['/scans/Placeholder scan.png'];
    await t.words.choose();
    let reading = t.words.read(null, null);
    (await t.reader()).said({ kind: 'failed', page: 0 });
    expect(await reading).toEqual({
      ok: false,
      message:
        'Placeholder scan.png could not be read as a picture: choose a PNG, JPEG, TIFF, WebP, GIF or BMP picture of the page.',
    });
    reading = t.words.read(null, null);
    for (let i = 0; i < 100 && t.readers.length < 2; i++) await new Promise((res) => setTimeout(res, 2));
    (await t.reader()).said({ kind: 'failed', page: null });
    const failed = await reading;
    expect(failed.ok).toBe(false);
    expect(failed.ok ? '' : failed.message).toMatch(/reader did not start/u);
    reading = t.words.read(null, null);
    for (let i = 0; i < 100 && t.readers.length < 3; i++) await new Promise((res) => setTimeout(res, 2));
    (await t.reader()).said({ kind: 'gone' });
    expect(await reading).toEqual({ ok: false, message: 'The reading stopped unexpectedly: try again.' });
  });

  it('Stop Reading stops the reading process at once: nothing added, and a second reading may start', async () => {
    const t = setup();
    t.chosen.files = ['/a.png'];
    await t.words.choose();
    expect(t.words.stop()).toBe(false);
    const reading = t.words.read(null, null);
    const r = await t.reader();
    r.said({ kind: 'reading', page: 0, fraction: 0.3 });
    // One reading at a time.
    expect(await t.words.read(null, null)).toEqual({
      ok: false,
      message: 'Words are being read now: wait for them, or click Stop Reading.',
    });
    expect(await t.words.choose()).toEqual({
      ok: false,
      message: 'Words are being read now: wait for them, or click Stop Reading.',
    });
    expect(t.words.stop()).toBe(true);
    expect(await reading).toEqual({ ok: false, message: READ_WORDS_STOPPED, stopped: true });
    expect(r.stopped).toBe(true);
    expect(t.progress.at(-1)).toBeNull();
    // Words it says after that are not heard.
    r.said({ kind: 'page', page: 0, text: 'late' });
    const again = t.words.read(null, null);
    for (let i = 0; i < 100 && t.readers.length < 2; i++) await new Promise((res) => setTimeout(res, 2));
    const r2 = await t.reader();
    r2.said({ kind: 'page', page: 0, text: 'શબ્દ' });
    r2.said({ kind: 'done' });
    expect(await again).toEqual({ ok: true, text: 'શબ્દ', pages: 1 });
  });

  it('a page that says nothing for too long is given up', async () => {
    const t = setup({ quietMs: 30 });
    t.chosen.files = ['/a.png'];
    await t.words.choose();
    const reading = t.words.read(null, null);
    const r = await t.reader();
    expect(await reading).toEqual({
      ok: false,
      message: 'Reading a page took too long: try a smaller or clearer picture of it.',
    });
    expect(r.stopped).toBe(true);
  });
});

describe('reading a PDF’s pages', () => {
  it('draws only the pages asked for, at the reading size, then reads them in order; the drawn pages are removed', async () => {
    const t = setup();
    t.chosen.files = ['/books/Placeholder book.pdf'];
    await t.words.choose();
    const reading = t.words.read(2, 3);
    const r = await t.reader();
    expect(t.drawn).toEqual([{ pdf: '/books/Placeholder book.pdf', outDir: t.dirs[0], pages: [1, 2] }]);
    expect(r.pages).toEqual(['/drawn/page-2.png', '/drawn/page-3.png']);
    expect(t.progress[0]).toEqual({ stage: 'drawing', page: 0, pages: 2, fraction: 0 });
    r.said({ kind: 'page', page: 0, text: 'બીજું' });
    r.said({ kind: 'page', page: 1, text: 'ત્રીજું' });
    r.said({ kind: 'done' });
    expect(await reading).toEqual({ ok: true, text: 'બીજું\n\nત્રીજું', pages: 2 });
    expect(existsSync(t.dirs[0] ?? '')).toBe(false);
    expect(READING_PAGE).toEqual({ width: 2480, height: 3508 });
  });

  it('past its end: how many pages it has, nothing read; a page that could not be drawn: which', async () => {
    const t = setup();
    t.chosen.files = ['/books/b.pdf'];
    await t.words.choose();
    t.drawWith(() => Promise.resolve({ ok: true, width: 1, height: 1, pages: [], total: 3, failed: [] }));
    expect(await t.words.read(4, 4)).toEqual({
      ok: false,
      message: 'The PDF has 3 pages: choose pages from 1 to 3.',
    });
    t.drawWith(() => Promise.resolve({ ok: true, width: 1, height: 1, pages: [], total: 1, failed: [] }));
    expect(await t.words.read(1, 2)).toEqual({ ok: false, message: 'The PDF has 1 page: choose page 1.' });
    t.drawWith(() =>
      Promise.resolve({
        ok: true,
        width: 1,
        height: 1,
        pages: [{ index: 0, file: '/drawn/page-1.png', notes: '' }],
        total: 3,
        failed: [1],
      }),
    );
    expect(await t.words.read(1, 2)).toEqual({
      ok: false,
      message: 'Page 2 of the PDF could not be drawn: it may be damaged. Save the PDF again and try again.',
    });
    t.drawWith(() => Promise.resolve({ ok: false, message: 'The PDF is protected with a password.' }));
    expect(await t.words.read(1, 1)).toEqual({ ok: false, message: 'The PDF is protected with a password.' });
    expect(t.readers).toHaveLength(0);
    for (const dir of t.dirs) expect(existsSync(dir)).toBe(false);
  });

  it('pages as numbers, the first no more than the last, at most 20 at once, within the first 400', async () => {
    const t = setup();
    t.chosen.files = ['/books/b.pdf'];
    await t.words.choose();
    const numbers = 'Give the pages as numbers, the first no more than the last.';
    expect(await t.words.read(0, 1)).toEqual({ ok: false, message: numbers });
    expect(await t.words.read(3, 2)).toEqual({ ok: false, message: numbers });
    expect(await t.words.read(1.5, 2)).toEqual({ ok: false, message: numbers });
    expect(await t.words.read('one', 2)).toEqual({ ok: false, message: numbers });
    expect(await t.words.read(1, 21)).toEqual({ ok: false, message: 'Read at most 20 pages at once.' });
    expect(await t.words.read(399, 401)).toEqual({
      ok: false,
      message: 'Only a PDF’s first 400 pages can be read.',
    });
    expect(t.drawn).toHaveLength(0);
  });

  it('Stop Reading while the pages are drawn stops the drawing: nothing read', async () => {
    const t = setup();
    t.chosen.files = ['/books/b.pdf'];
    await t.words.choose();
    t.drawWith(
      (_pages, signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            resolve({ ok: false, message: 'Cancelled.' });
          });
        }),
    );
    const reading = t.words.read(1, 1);
    for (let i = 0; i < 100 && t.drawn.length === 0; i++) await new Promise((r) => setTimeout(r, 2));
    expect(t.words.stop()).toBe(true);
    expect(await reading).toEqual({ ok: false, message: READ_WORDS_STOPPED, stopped: true });
    expect(t.readers).toHaveLength(0);
  });
});

describe('what the reading process may say', () => {
  it('only its own words, whole', () => {
    expect(isReaderSays({ kind: 'starting', fraction: 0.5 })).toBe(true);
    expect(isReaderSays({ kind: 'reading', page: 2, fraction: 1 })).toBe(true);
    expect(isReaderSays({ kind: 'page', page: 0, text: '' })).toBe(true);
    expect(isReaderSays({ kind: 'done' })).toBe(true);
    expect(isReaderSays({ kind: 'failed', page: null })).toBe(true);
    expect(isReaderSays({ kind: 'failed', page: 3 })).toBe(true);
    expect(isReaderSays({ kind: 'starting', fraction: 2 })).toBe(false);
    expect(isReaderSays({ kind: 'reading', page: -1, fraction: 0 })).toBe(false);
    expect(isReaderSays({ kind: 'page', page: 0 })).toBe(false);
    expect(isReaderSays({ kind: 'failed' })).toBe(false);
    expect(isReaderSays({ kind: 'other' })).toBe(false);
    expect(isReaderSays(null)).toBe(false);
  });
});
