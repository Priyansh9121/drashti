import type { BrowserWindow, WebContents } from 'electron';
import type { PdfJob, PdfPageReceipt, PreparedSource } from '../../shared/editable-source';
import type { SourceRead } from '../documents/source-reader';
import { EditablePdfSessions } from './editable-pdf-session';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { availableParallelism, constants, setPriority } from 'node:os';
import { join } from 'node:path';
import type {
  DrawnPicturePage,
  PageShare,
  PictureAssetKind,
  PictureJob,
  PicturePage,
  PicturesDone,
  PicturesResult,
} from '../../shared/pictures';
import {
  inShare,
  MAX_PAGE_TEXT,
  MAX_PICTURE_PAGES,
  PICTURE_ASSET_NAME,
  tidyNotes,
} from '../../shared/pictures';
import type { ScreenConfig } from '../../shared/screens';
import { fileProblem } from '../plain-errors';
import { cutText } from '../../shared/text';

/*
 * Drawing a PDF's pages as pictures (Session 15), in the main process's
 * charge: a hidden window of its own (src/renderer/pdf.html) draws each page
 * with pdf.js and hands it back, and each picture is written to the folder
 * the import gave. One document at a time; the window's process runs at the
 * lowest priority and goes as soon as the document is done, so the show
 * never waits for it. The import worker asks for this (it cannot open a
 * window) and makes the slides from what comes back.
 *
 * Several pages at once (Session 56): while nothing is up on the screens and
 * the stream is neither on air nor recording (`wide`), a document is drawn by
 * several such windows, each every so many pages. Should the show start
 * meanwhile, all but the first stop at their next page, and once the first is
 * done the pages they left are drawn by one window, as before.
 */

/**
 * The size pictures are made at: the canvas of the first audience group's
 * first screen (what the hall sees), or 1920 × 1080 when there is none, within
 * what a picture can sensibly be.
 */
export function pictureSize(
  screens: readonly ScreenConfig[],
  audienceGroup: string | null,
): { width: number; height: number } {
  const screen = audienceGroup ? screens.find((s) => s.groupId === audienceGroup) : undefined;
  if (!screen) return { width: 1920, height: 1080 };
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));
  return { width: clamp(screen.canvasWidth, 320, 7680), height: clamp(screen.canvasHeight, 180, 4320) };
}

/** A PDF bigger than this is not drawn. */
export const MAX_PDF_BYTES = 500 * 1024 * 1024;
/** A document taking longer than this is given up. */
const TIMEOUT_MS = 15 * 60 * 1000;
/** Several windows draw a document at once only if it is no bigger than this (each holds its own copy). */
const WIDE_MAX_BYTES = 200 * 1024 * 1024;

/** How many windows draw a document at once when they may: half the processors, two or three. */
export const windowsAtOnce = (processors: number): number =>
  Math.min(3, Math.max(2, Math.floor(processors / 2)));

/** A PNG as the page hands it over: its signature, and at most this many bytes. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_PNG_BYTES = 64 * 1024 * 1024;

export interface PdfPicturesDeps {
  /** A hidden window for drawing, its page loaded (the app's secure settings and preload). */
  open(): BrowserWindow;
  /** The size pictures are made at: the canvas every page is fitted into. */
  size(): { width: number; height: number };
  /** Folders pdf.js's own data may be read from, by kind (the built app's, then node_modules'). */
  assetDirs(kind: PictureAssetKind): string[];
  log(message: string): void;
  /**
   * Whether a document's pages may be drawn several at once now (Session 56): only while nothing is up on the screens
   * and the stream is neither on air nor recording. Left out: one at a time, always.
   */
  wide?: () => boolean;
  /** How many windows draw at once when they may (tests; else by the computer's processors). */
  atOnce?: number;
}

interface Drawing {
  /** The windows drawing it, the first first: each with its job (its share of the pages) and whether it is done. */
  windows: { win: BrowserWindow; job: PictureJob; done: boolean }[];
  outDir: string;
  pages: Map<number, DrawnPicturePage>;
  failed: Set<number>;
  /** The document's pages, as a window said. */
  total: number;
  stopped: boolean;
  finish(result: PicturesResult): void;
  /** The pages windows left, to be drawn by one window of their own (set as it starts). */
  catchUp?: (pages: number[]) => void;
}

export class PdfPictures {
  private drawing: Drawing | null = null;
  private readonly editable: EditablePdfSessions;
  private editableWaiting = 0;
  /** Waiting for their turn: one document at a time. */
  private turn: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: PdfPicturesDeps) {
    this.editable = new EditablePdfSessions(() => deps.open());
  }

  /** Native source mode shares the original drawing queue; ordinary draw behavior is unchanged. */
  readEditable(request: SourceRead): Promise<PreparedSource> {
    const isAborted = (): boolean => request.signal.aborted;
    if (isAborted() || this.editableWaiting >= 4)
      return Promise.resolve({
        ok: false,
        message:
          'Drashti is busy reading other documents. The slides still show as before; try again in a moment.',
      });
    this.editableWaiting++;
    let started = false;
    let onAbort: () => void = () => undefined;
    const cancelled = new Promise<PreparedSource>((resolve) => {
      onAbort = () => {
        if (!started)
          resolve({
            ok: false,
            message: 'Reading the original’s words and shapes was stopped. The slides still show as before.',
          });
      };
      request.signal.addEventListener('abort', onAbort, { once: true });
    });
    const run = this.turn
      .then(() => {
        started = true;
        return this.editable.readNow(request);
      })
      .finally(() => {
        this.editableWaiting--;
      });
    this.turn = run.catch(() => undefined);
    if (isAborted()) onAbort();
    // A queued cancelled slot stays counted until consumed, so repeated cancel cannot grow the chain.
    // An active job resolves through its session only after owned Main PNG writes have settled.
    return Promise.race([run, cancelled]).finally(() => request.signal.removeEventListener('abort', onAbort));
  }

  stopEditable(): void {
    this.editable.stop();
  }

  /** The drawing a window belongs to, and its place among its windows (null: none of ours). */
  private windowOf(sender: WebContents): { d: Drawing; at: number } | null {
    const d = this.drawing;
    const at = d ? d.windows.findIndex((w) => w.win.webContents.id === sender.id) : -1;
    return d && at >= 0 ? { d, at } : null;
  }

  /** Draw every page of a PDF (up to the limit) into `outDir` as PNGs. */
  draw(
    pdfPath: string,
    outDir: string,
    signal?: AbortSignal,
    readPageText?: boolean,
  ): Promise<PicturesResult> {
    const run = this.turn.then(() => this.drawNow(pdfPath, outDir, signal, readPageText));
    this.turn = run.catch(() => undefined);
    return run;
  }

  private async drawNow(
    pdfPath: string,
    outDir: string,
    signal?: AbortSignal,
    readPageText?: boolean,
  ): Promise<PicturesResult> {
    if (signal?.aborted) return { ok: false, message: 'Cancelled.' };
    let data: Buffer;
    try {
      data = await readFile(pdfPath);
    } catch (error) {
      return { ok: false, message: `The PDF could not be read. ${fileProblem(error, 'read')}` };
    }
    if (data.length > MAX_PDF_BYTES)
      return {
        ok: false,
        message:
          'The PDF is too big to draw (over 500 MB): save it again with smaller pictures, or in parts, and import those.',
      };
    await mkdir(outDir, { recursive: true });
    const { width, height } = this.deps.size();
    const started = Date.now();
    // Several at once only while nothing is on the screens or the stream (Session 56), and a document not too big.
    const atOnce =
      data.length <= WIDE_MAX_BYTES && this.deps.wide?.() === true
        ? (this.deps.atOnce ?? windowsAtOnce(availableParallelism()))
        : 1;
    return new Promise<PicturesResult>((resolve) => {
      const opened: BrowserWindow[] = [];
      try {
        for (let k = 0; k < atOnce; k++) opened.push(this.deps.open());
      } catch {
        for (const w of opened) if (!w.isDestroyed()) w.destroy();
        resolve({
          ok: false,
          message:
            'The window that draws the pages could not open: quit Drashti, start it again, then import the PDF again.',
        });
        return;
      }
      const timer = setTimeout(() => {
        finish({
          ok: false,
          message:
            'Drawing the pages took too long (over 15 minutes): save the PDF again in smaller parts and import those one at a time.',
        });
      }, TIMEOUT_MS);
      const onAbort = () => {
        drawing.stopped = true;
        finish({ ok: false, message: 'Cancelled.' });
      };
      const jobFor = (share?: PageShare): PictureJob => ({
        data: new Uint8Array(data),
        width,
        height,
        maxPages: MAX_PICTURE_PAGES,
        ...(readPageText ? { readPageText } : {}),
        ...(share ? { share } : {}),
      });
      const drawing: Drawing = {
        windows: opened.map((win, k) => ({
          win,
          job: jobFor(opened.length > 1 ? { every: opened.length, from: k } : undefined),
          done: false,
        })),
        outDir,
        pages: new Map(),
        failed: new Set(),
        total: 0,
        stopped: false,
        finish: (result) => {
          finish(result);
        },
      };
      let finished = false;
      const finish = (result: PicturesResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (this.drawing === drawing) this.drawing = null;
        for (const { win } of drawing.windows) if (!win.isDestroyed()) win.destroy();
        this.deps.log(
          result.ok
            ? `Pictures: drew ${String(result.pages.length)} page(s) of ${String(result.total)} in ${String(Date.now() - started)} ms, ${String(atOnce)} at once`
            : `Pictures: a PDF was not drawn (${result.message})`,
        );
        resolve(result);
      };
      this.drawing = drawing;
      signal?.addEventListener('abort', onAbort);
      const watch = (win: BrowserWindow) => {
        win.webContents.on('render-process-gone', () => {
          // A window that has said it is done has nothing left to lose.
          if (drawing.windows.find((w) => w.win === win)?.done) return;
          finish({
            ok: false,
            message:
              'The window drawing the pages stopped unexpectedly: import the PDF again; if it stops again, save it again from the program that made it.',
          });
        });
        // The lowest priority: whenever the computer is busy, the show's processes come first.
        win.webContents.once('dom-ready', () => {
          try {
            setPriority(win.webContents.getOSProcessId(), constants.priority.PRIORITY_LOW);
          } catch {
            // Not allowed on this system: it runs at normal priority.
          }
        });
      };
      for (const { win } of drawing.windows) watch(win);
      /**
       * Pages a window left when the show started (or ones it never reached): drawn by one window of their own once
       * every window is done.
       */
      drawing.catchUp = (pages: number[]) => {
        let win: BrowserWindow;
        try {
          win = this.deps.open();
        } catch {
          finish({
            ok: false,
            message:
              'The window that draws the pages could not open: quit Drashti, start it again, then import the PDF again.',
          });
          return;
        }
        drawing.windows.push({ win, job: jobFor({ pages }), done: false });
        watch(win);
      };
    });
  }

  /** The drawing window asks what to draw (once): nothing for any other page. */
  job(sender: WebContents): PdfJob | null {
    if (this.editable.owns(sender)) return this.editable.job(sender);
    const of = this.windowOf(sender);
    return of ? (of.d.windows[of.at]?.job ?? null) : null;
  }

  /** A page as drawn: kept as a PNG in the import's folder. False tells the window to stop. */
  async page(sender: WebContents, raw: unknown): Promise<PdfPageReceipt> {
    if (this.editable.owns(sender)) return this.editable.page(sender, raw);
    const of = this.windowOf(sender);
    if (!of) return false;
    const { d, at } = of;
    const job = d.windows[at]?.job;
    const share = job?.share;
    // A window drawing beside the first stops at its next page once the show has started (Session 56).
    const goOn = () => !d.stopped && !(at > 0 && share && 'every' in share && this.deps.wide?.() !== true);
    const page = raw as Partial<PicturePage> | null;
    const index = page?.index;
    const png = page?.png;
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= MAX_PICTURE_PAGES ||
      !(png instanceof Uint8Array) ||
      png.length > MAX_PNG_BYTES ||
      !PNG_SIGNATURE.every((b, i) => png[i] === b) ||
      !inShare(share, index)
    )
      return goOn();
    const file = join(d.outDir, `page-${String(index + 1).padStart(4, '0')}.png`);
    await writeFile(file, png);
    const notes = page?.notes;
    const pageText = page?.pageText;
    d.pages.set(index, {
      index,
      file,
      notes: tidyNotes(typeof notes === 'string' ? notes : ''),
      ...(job?.readPageText && typeof pageText === 'string' && pageText.length <= MAX_PAGE_TEXT
        ? { pageText }
        : {}),
    });
    return goOn();
  }

  /** The window has drawn what it could. */
  done(sender: WebContents, raw: unknown): void {
    if (this.editable.owns(sender)) {
      this.editable.done(sender, raw);
      return;
    }
    const of = this.windowOf(sender);
    const mine = of ? of.d.windows[of.at] : undefined;
    if (!of || !mine || mine.done) return;
    const { d } = of;
    const done = raw as Partial<PicturesDone> | null;
    if (typeof done?.error === 'string') {
      d.finish({ ok: false, message: cutText(done.error, 300) });
      return;
    }
    mine.done = true;
    const total = typeof done?.total === 'number' && Number.isInteger(done.total) ? done.total : 0;
    d.total = Math.max(d.total, total);
    const max = mine.job.maxPages;
    if (Array.isArray(done?.failed))
      for (const n of done.failed) if (Number.isInteger(n) && n >= 0 && n < max) d.failed.add(n);
    if (d.windows.some((w) => !w.done)) return;
    // Every window done: the pages a window left (it stopped as the show started) are drawn by one window now.
    const left: number[] = [];
    for (let i = 0; i < Math.min(d.total, max); i++) if (!d.pages.has(i) && !d.failed.has(i)) left.push(i);
    if (
      left.length > 0 &&
      d.windows.length > 1 &&
      !d.windows.some((w) => w.job.share && 'pages' in w.job.share)
    ) {
      d.catchUp?.(left);
      return;
    }
    const pages = [...d.pages.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
    const failed = [...d.failed].sort((a, b) => a - b);
    if (pages.length === 0)
      d.finish({ ok: false, message: d.total === 0 ? 'The PDF has no pages.' : 'No page could be drawn.' });
    else
      d.finish({ ok: true, width: mine.job.width, height: mine.job.height, pages, total: d.total, failed });
  }

  /** pdf.js's own data: a plain name from one of its own folders, for the drawing window only. */
  async asset(sender: WebContents, kind: unknown, name: unknown): Promise<Uint8Array | null> {
    if (!this.windowOf(sender) && !this.editable.owns(sender)) return null;
    if (kind !== 'standardFontDataUrl' && kind !== 'wasmUrl' && kind !== 'cMapUrl') return null;
    if (typeof name !== 'string' || !PICTURE_ASSET_NAME.test(name) || name.startsWith('.')) return null;
    for (const dir of this.deps.assetDirs(kind)) {
      try {
        return new Uint8Array(await readFile(join(dir, name)));
      } catch {
        // Not here: the next folder.
      }
    }
    return null;
  }
}
