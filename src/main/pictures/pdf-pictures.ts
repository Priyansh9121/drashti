import type { BrowserWindow, WebContents } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants, setPriority } from 'node:os';
import { join } from 'node:path';
import type {
  PictureAssetKind,
  PictureJob,
  PicturePage,
  PicturesDone,
  PicturesResult,
} from '../../shared/pictures';
import { MAX_PICTURE_PAGES, PICTURE_ASSET_NAME, tidyNotes } from '../../shared/pictures';
import type { ScreenConfig } from '../../shared/screens';

/*
 * Drawing a PDF's pages as pictures (Session 15), in the main process's
 * charge: a hidden window of its own (src/renderer/pdf.html) draws each page
 * with pdf.js and hands it back, and each picture is written to the folder
 * the import gave. One document at a time; the window's process runs at the
 * lowest priority and goes as soon as the document is done, so the show
 * never waits for it. The import worker asks for this (it cannot open a
 * window) and makes the slides from what comes back.
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
}

interface Drawing {
  win: BrowserWindow;
  job: PictureJob;
  outDir: string;
  pages: Map<number, { index: number; file: string; notes: string }>;
  stopped: boolean;
  finish(result: PicturesResult): void;
}

export class PdfPictures {
  private drawing: Drawing | null = null;
  /** Waiting for their turn: one document at a time. */
  private turn: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: PdfPicturesDeps) {}

  /** Draw every page of a PDF (up to the limit) into `outDir` as PNGs. */
  draw(pdfPath: string, outDir: string, signal?: AbortSignal): Promise<PicturesResult> {
    const run = this.turn.then(() => this.drawNow(pdfPath, outDir, signal));
    this.turn = run.catch(() => undefined);
    return run;
  }

  private async drawNow(pdfPath: string, outDir: string, signal?: AbortSignal): Promise<PicturesResult> {
    if (signal?.aborted) return { ok: false, message: 'Cancelled.' };
    let data: Buffer;
    try {
      data = await readFile(pdfPath);
    } catch {
      return { ok: false, message: 'The PDF could not be read.' };
    }
    if (data.length > MAX_PDF_BYTES)
      return { ok: false, message: 'The PDF is too big to draw (over 500 MB).' };
    await mkdir(outDir, { recursive: true });
    const { width, height } = this.deps.size();
    const started = Date.now();
    return new Promise<PicturesResult>((resolve) => {
      let win: BrowserWindow;
      try {
        win = this.deps.open();
      } catch {
        resolve({ ok: false, message: 'The window that draws the pages could not open.' });
        return;
      }
      const timer = setTimeout(() => {
        finish({ ok: false, message: 'Drawing the pages took too long (over 15 minutes).' });
      }, TIMEOUT_MS);
      const onAbort = () => {
        drawing.stopped = true;
        finish({ ok: false, message: 'Cancelled.' });
      };
      const drawing: Drawing = {
        win,
        job: { data: new Uint8Array(data), width, height, maxPages: MAX_PICTURE_PAGES },
        outDir,
        pages: new Map(),
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
        if (!win.isDestroyed()) win.destroy();
        this.deps.log(
          result.ok
            ? `Pictures: drew ${String(result.pages.length)} page(s) of ${String(result.total)} in ${String(Date.now() - started)} ms`
            : `Pictures: a PDF was not drawn (${result.message})`,
        );
        resolve(result);
      };
      this.drawing = drawing;
      signal?.addEventListener('abort', onAbort);
      win.webContents.on('render-process-gone', () => {
        finish({ ok: false, message: 'The window drawing the pages stopped unexpectedly.' });
      });
      // The lowest priority: whenever the computer is busy, the show's processes come first.
      win.webContents.once('dom-ready', () => {
        try {
          setPriority(win.webContents.getOSProcessId(), constants.priority.PRIORITY_LOW);
        } catch {
          // Not allowed on this system: it runs at normal priority.
        }
      });
    });
  }

  /** The drawing window asks what to draw (once): nothing for any other page. */
  job(sender: WebContents): PictureJob | null {
    const d = this.drawing;
    return d?.win.webContents.id === sender.id ? d.job : null;
  }

  /** A page as drawn: kept as a PNG in the import's folder. False tells the window to stop. */
  async page(sender: WebContents, raw: unknown): Promise<boolean> {
    const d = this.drawing;
    if (d?.win.webContents.id !== sender.id) return false;
    const page = raw as Partial<PicturePage> | null;
    const index = page?.index;
    const png = page?.png;
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= d.job.maxPages ||
      !(png instanceof Uint8Array) ||
      png.length > MAX_PNG_BYTES ||
      !PNG_SIGNATURE.every((b, i) => png[i] === b)
    )
      return !d.stopped;
    const file = join(d.outDir, `page-${String(index + 1).padStart(4, '0')}.png`);
    await writeFile(file, png);
    const notes = page?.notes;
    d.pages.set(index, { index, file, notes: tidyNotes(typeof notes === 'string' ? notes : '') });
    return !d.stopped;
  }

  /** The window has drawn what it could. */
  done(sender: WebContents, raw: unknown): void {
    const d = this.drawing;
    if (d?.win.webContents.id !== sender.id) return;
    const done = raw as Partial<PicturesDone> | null;
    const total = typeof done?.total === 'number' && Number.isInteger(done.total) ? done.total : 0;
    if (typeof done?.error === 'string') {
      d.finish({ ok: false, message: done.error.slice(0, 300) });
      return;
    }
    const failed = Array.isArray(done?.failed)
      ? done.failed.filter((n): n is number => Number.isInteger(n)).slice(0, d.job.maxPages)
      : [];
    const pages = [...d.pages.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
    if (pages.length === 0)
      d.finish({ ok: false, message: total === 0 ? 'The PDF has no pages.' : 'No page could be drawn.' });
    else d.finish({ ok: true, width: d.job.width, height: d.job.height, pages, total, failed });
  }

  /** pdf.js's own data: a plain name from one of its own folders, for the drawing window only. */
  async asset(sender: WebContents, kind: unknown, name: unknown): Promise<Uint8Array | null> {
    const d = this.drawing;
    if (d?.win.webContents.id !== sender.id) return null;
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
