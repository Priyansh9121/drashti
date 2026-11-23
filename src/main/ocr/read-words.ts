import { rm } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { PicturesResult } from '../../shared/pictures';
import { MAX_PICTURE_PAGES } from '../../shared/pictures';
import type { ReadWordsChoice, ReadWordsProgress, ReadWordsResult } from '../../shared/read-words';
import { READ_WORDS_MAX_PAGES, READ_WORDS_PICTURES, READ_WORDS_STOPPED } from '../../shared/read-words';
import type { ReaderHandle } from './reader-process';
import type { ReaderSays } from './reader-protocol';

/*
 * New presentation's Read Words from a Page… (book OCR, alpha.21; the owner's Q60-58, "A, Tesseract inside"): the
 * operator chooses scanned pictures, or a PDF and which of its pages, and their words are read by Tesseract inside
 * Drashti, in the reading process (never Main's thread, at the lowest priority), into the words box to be read over
 * before Make slides. A PDF's pages are drawn as pictures first, by the pictures window (pdf-pictures.ts), on white.
 * One reading at a time; Stop Reading stops it at once and nothing is added. It is an editing tool: the words say to
 * read pages before the show, not while slides are changing on the screens.
 */

/** A PDF page is drawn for reading at A4's shape at 300 pixels an inch (as the engine trial read its pages). */
export const READING_PAGE = { width: 2480, height: 3508 } as const;

/** A page that has said nothing for this long is given up. */
const QUIET_MS = 120_000;

export interface ReadWordsDeps {
  /** The system's dialog: the files chosen, or null. */
  choose(): Promise<string[] | null>;
  /** A PDF's pages (from 0) drawn as pictures into `outDir`. */
  drawPages(pdf: string, outDir: string, pages: number[], signal: AbortSignal): Promise<PicturesResult>;
  /** The reading process, given the pictures in order. */
  startReader(pages: string[], said: (m: ReaderSays | { kind: 'gone' }) => void): ReaderHandle;
  /** A folder of its own for a reading's drawn pages (removed after). */
  tempDir(): Promise<string>;
  progress(progress: ReadWordsProgress | null): void;
  log(line: string): void;
  /** Tests: a page given up after this long without a word from the reader. */
  quietMs?: number;
}

type Chosen = { kind: 'pictures'; files: string[] } | { kind: 'pdf'; file: string };

const ending = (file: string) => extname(file).slice(1).toLowerCase();
const isPdf = (file: string) => ending(file) === 'pdf';
const isPicture = (file: string) => (READ_WORDS_PICTURES as readonly string[]).includes(ending(file));
const byName = (a: string, b: string) =>
  basename(a).localeCompare(basename(b), undefined, { numeric: true, sensitivity: 'base' });

const BUSY = 'Words are being read now: wait for them, or click Stop Reading.';
const PICTURES_ONLY = 'Choose pictures (PNG, JPEG, TIFF, WebP, GIF or BMP) or one PDF.';

export class ReadWords {
  private chosen: Chosen | null = null;
  private running: AbortController | null = null;

  constructor(private readonly deps: ReadWordsDeps) {}

  async choose(): Promise<ReadWordsChoice> {
    if (this.running) return { ok: false, message: BUSY };
    const files = await this.deps.choose();
    if (!files || files.length === 0) return { ok: false, cancelled: true };
    if (files.some(isPdf)) {
      const [file] = files;
      if (files.length > 1 || file === undefined) return { ok: false, message: 'Choose one PDF at a time.' };
      this.chosen = { kind: 'pdf', file };
      return { ok: true, kind: 'pdf', name: basename(file) };
    }
    if (!files.every(isPicture)) return { ok: false, message: PICTURES_ONLY };
    if (files.length > READ_WORDS_MAX_PAGES)
      return { ok: false, message: `Choose at most ${String(READ_WORDS_MAX_PAGES)} pictures at once.` };
    const sorted = [...files].sort(byName);
    this.chosen = { kind: 'pictures', files: sorted };
    return { ok: true, kind: 'pictures', names: sorted.map((f) => basename(f)) };
  }

  /** Stop the reading going on: true when there was one. */
  stop(): boolean {
    if (!this.running) return false;
    this.running.abort();
    return true;
  }

  /** Read the chosen pictures, or the chosen PDF's pages `fromPage` to `toPage` (from 1). */
  async read(fromPage: unknown, toPage: unknown): Promise<ReadWordsResult> {
    const chosen = this.chosen;
    if (!chosen) return { ok: false, message: 'Choose the pages to read first: Read Words from a Page….' };
    if (this.running) return { ok: false, message: BUSY };
    const stop = new AbortController();
    this.running = stop;
    const started = Date.now();
    try {
      const result = await this.readNow(chosen, fromPage, toPage, stop.signal);
      this.deps.log(
        result.ok
          ? `Read words: ${String(result.pages)} page(s), ${String(result.text.length)} characters, in ${String(Date.now() - started)} ms`
          : `Read words: none (${result.message})`,
      );
      return result;
    } finally {
      this.running = null;
      this.deps.progress(null);
    }
  }

  private async readNow(
    chosen: Chosen,
    fromPage: unknown,
    toPage: unknown,
    signal: AbortSignal,
  ): Promise<ReadWordsResult> {
    if (chosen.kind === 'pictures')
      return this.readPictures(
        chosen.files,
        chosen.files.map((f) => basename(f)),
        signal,
      );
    const from = Number(fromPage);
    const to = Number(toPage);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from)
      return { ok: false, message: 'Give the pages as numbers, the first no more than the last.' };
    if (to - from + 1 > READ_WORDS_MAX_PAGES)
      return { ok: false, message: `Read at most ${String(READ_WORDS_MAX_PAGES)} pages at once.` };
    if (to > MAX_PICTURE_PAGES)
      return { ok: false, message: `Only a PDF’s first ${String(MAX_PICTURE_PAGES)} pages can be read.` };
    const count = to - from + 1;
    const wanted = Array.from({ length: count }, (_, k) => from - 1 + k);
    const dir = await this.deps.tempDir();
    try {
      this.deps.progress({ stage: 'drawing', page: 0, pages: count, fraction: 0 });
      const drawn = await this.deps.drawPages(chosen.file, dir, wanted, signal);
      if (signal.aborted) return { ok: false, message: READ_WORDS_STOPPED, stopped: true };
      if (!drawn.ok) return { ok: false, message: drawn.message };
      if (to > drawn.total)
        return {
          ok: false,
          message:
            drawn.total === 1
              ? 'The PDF has 1 page: choose page 1.'
              : `The PDF has ${String(drawn.total)} pages: choose pages from 1 to ${String(drawn.total)}.`,
        };
      const missing = wanted.find((index) => !drawn.pages.some((p) => p.index === index));
      if (missing !== undefined)
        return {
          ok: false,
          message: `Page ${String(missing + 1)} of the PDF could not be drawn: it may be damaged. Save the PDF again and try again.`,
        };
      const files = wanted.map((index) => drawn.pages.find((p) => p.index === index)?.file ?? '');
      return await this.readPictures(
        files,
        wanted.map((index) => `Page ${String(index + 1)}`),
        signal,
      );
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** The reading process reads `files` in order; `names` say which page could not be read. */
  private readPictures(files: string[], names: string[], signal: AbortSignal): Promise<ReadWordsResult> {
    if (signal.aborted) return Promise.resolve({ ok: false, message: READ_WORDS_STOPPED, stopped: true });
    const pages = files.length;
    return new Promise<ReadWordsResult>((resolve) => {
      const texts: string[] = Array.from({ length: pages }, () => '');
      let shown = { stage: '', page: -1, fraction: -1 };
      let quiet: ReturnType<typeof setTimeout> | undefined;
      let finished = false;
      const finish = (result: ReadWordsResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(quiet);
        signal.removeEventListener('abort', onAbort);
        reader.stop();
        resolve(result);
      };
      const listen = () => {
        clearTimeout(quiet);
        quiet = setTimeout(() => {
          finish({
            ok: false,
            message: 'Reading a page took too long: try a smaller or clearer picture of it.',
          });
        }, this.deps.quietMs ?? QUIET_MS);
      };
      const show = (progress: ReadWordsProgress) => {
        // A step of a hundredth at least, or a new stage or page: the progress bar needs no more.
        if (
          progress.stage === shown.stage &&
          progress.page === shown.page &&
          progress.fraction - shown.fraction < 0.01
        )
          return;
        shown = { stage: progress.stage, page: progress.page, fraction: progress.fraction };
        this.deps.progress(progress);
      };
      const onAbort = () => {
        finish({ ok: false, message: READ_WORDS_STOPPED, stopped: true });
      };
      const reader = this.deps.startReader(files, (m) => {
        if (finished) return;
        listen();
        switch (m.kind) {
          case 'starting':
            show({ stage: 'starting', page: 1, pages, fraction: 0 });
            return;
          case 'reading':
            show({ stage: 'reading', page: m.page + 1, pages, fraction: (m.page + m.fraction) / pages });
            return;
          case 'page':
            if (m.page < pages) texts[m.page] = m.text;
            return;
          case 'done': {
            const text = texts.filter((t) => t !== '').join('\n\n');
            finish(
              text === ''
                ? {
                    ok: false,
                    message:
                      pages === 1
                        ? 'No words were found on the page: choose a clearer picture of it.'
                        : 'No words were found on these pages: choose clearer pictures of them.',
                  }
                : { ok: true, text, pages },
            );
            return;
          }
          case 'failed':
            finish({
              ok: false,
              message:
                m.page === null
                  ? 'The words could not be read: Drashti’s reader did not start. Quit Drashti, start it again, then try again.'
                  : `${names[m.page] ?? 'A page'} could not be read as a picture: choose a PNG, JPEG, TIFF, WebP, GIF or BMP picture of the page.`,
            });
            return;
          case 'gone':
            finish({ ok: false, message: 'The reading stopped unexpectedly: try again.' });
            return;
        }
      });
      signal.addEventListener('abort', onAbort);
      listen();
    });
  }
}
