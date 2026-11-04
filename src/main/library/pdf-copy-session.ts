import type { BrowserWindow, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { constants, setPriority } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { PdfCopyJob, PdfCopyPage, PdfPrintPage } from '../../shared/pdf-copy';
import { PICTURE_ASSET_NAME, type PictureAssetKind } from '../../shared/pictures';

const LIMIT = 64 * 1024 * 1024;
const MAX_PAGES = 400;
const DEADLINE_MS = 180_000;
const printPageSchema = z.object({
  ref: z.object({ num: z.number().int().positive(), gen: z.number().int().min(0).max(65535) }),
  view: z.array(z.number()).length(4),
  rotate: z.number().int(),
});
const finishedSchema = z.object({
  id: z.uuid(),
  data: z
    .instanceof(Uint8Array)
    .refine((data) => data.length > 8 && data.length <= LIMIT)
    .optional(),
  pages: z
    .array(
      z.object({ width: z.number().positive().max(100_000), height: z.number().positive().max(100_000) }),
    )
    .max(MAX_PAGES)
    .optional(),
  error: z.string().max(300).optional(),
});

export interface PdfCopySessionDeps {
  open(): BrowserWindow;
  assetDirs(kind: PictureAssetKind): string[];
  /** Runs only on bytes just printed here; the output geometry worker never receives imported PDFs. */
  normalize(
    data: Uint8Array,
    pages: PdfPrintPage[],
    target: { width: number; height: number },
    signal: AbortSignal,
  ): Promise<Uint8Array>;
}
interface ActiveCopy {
  win: BrowserWindow;
  job: PdfCopyJob;
  signal: AbortSignal;
  current(): boolean;
  finish(data: Uint8Array | null): void;
  taken: boolean;
  captures: number;
  captureBytes: number;
  next: number;
  printing: boolean;
  fresh: { index: number; data: Uint8Array } | null;
}

/** One private hidden export job; no operator/phone page can print, submit metadata or supply output bytes. */
export class PdfCopySession {
  private active: ActiveCopy | null = null;

  constructor(private readonly deps: PdfCopySessionDeps) {}

  async run(
    plan: Omit<PdfCopyJob, 'id'>,
    current: () => boolean,
    signal: AbortSignal,
  ): Promise<Uint8Array | null> {
    if (this.active || signal.aborted || !current() || !plan.pages.length || plan.pages.length > MAX_PAGES)
      return null;
    if (plan.sources.reduce((total, source) => total + source.data.length, 0) > 256 * 1024 * 1024)
      return null;
    const ids = new Set(plan.sources.map((source) => source.id));
    for (const page of plan.pages) {
      if (
        page.kind === 'original' &&
        (!ids.has(page.sourceId) || !Number.isInteger(page.page) || page.page < 0)
      )
        return null;
      if (
        page.kind === 'native' &&
        (page.slide.deck ||
          page.slide.width < 16 ||
          page.slide.height < 16 ||
          page.slide.width > 14_400 ||
          page.slide.height > 14_400)
      )
        return null;
    }
    let win: BrowserWindow;
    try {
      win = this.deps.open();
    } catch {
      return null;
    }
    return new Promise((resolve) => {
      let ended = false;
      const finish = (data: Uint8Array | null) => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (this.active === active) this.active = null;
        if (!win.isDestroyed()) win.destroy();
        resolve(data);
      };
      const active: ActiveCopy = {
        win,
        job: { ...plan, id: randomUUID() },
        signal,
        current,
        finish,
        taken: false,
        captures: 0,
        captureBytes: 0,
        next: nextNative(plan.pages, 0),
        printing: false,
        fresh: null,
      };
      const abort = () => finish(null);
      const timer = setTimeout(abort, DEADLINE_MS);
      this.active = active;
      signal.addEventListener('abort', abort, { once: true });
      win.webContents.once('render-process-gone', abort);
      win.once('closed', abort);
      win.webContents.once('dom-ready', () => {
        try {
          setPriority(win.webContents.getOSProcessId(), constants.priority.PRIORITY_LOW);
        } catch {
          /* The owned process still has a bounded deadline. */
        }
      });
      if (signal.aborted || !current()) abort();
    });
  }

  private own(sender: WebContents): ActiveCopy | null {
    const active = this.active;
    if (active?.win.webContents.id !== sender.id) return null;
    if (active.signal.aborted || !active.current()) {
      active.finish(null);
      return null;
    }
    return active;
  }

  job(sender: WebContents): PdfCopyJob | null {
    const active = this.own(sender);
    if (!active || active.taken) return null;
    active.taken = true;
    return active.job;
  }

  /** Only the owned hidden page can flatten its decorative text effects.
   * The actual words remain native/searchable in the subsequent print. */
  async capture(sender: WebContents, id: unknown, index: unknown): Promise<Uint8Array | null> {
    const active = this.own(sender);
    if (
      !active ||
      typeof index !== 'number' ||
      !active.taken ||
      active.job.id !== id ||
      active.next !== index ||
      active.printing ||
      active.fresh ||
      active.captures >= 128
    )
      return null;
    const page = active.job.pages[index];
    if (page?.kind !== 'native') return null;
    const width = Math.ceil((page.slide.width * 4) / 3),
      height = Math.ceil((page.slide.height * 4) / 3);
    // Bound viewport and screenshot memory as well as compressed output bytes.
    if (width * height > 4_000_000) return null;
    active.printing = true;
    active.captures++;
    try {
      active.win.setContentSize(width, height);
      await active.win.webContents.executeJavaScript(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
      if (this.own(sender) !== active) return null;
      const image = await active.win.webContents.capturePage(
        { x: 0, y: 0, width, height },
        { stayHidden: true },
      );
      if (this.own(sender) !== active || image.isEmpty()) return null;
      const data = image.toPNG();
      active.captureBytes += data.length;
      if (data.length > 32 * 1024 * 1024 || active.captureBytes > LIMIT) return null;
      return new Uint8Array(data);
    } catch {
      active.finish(null);
      return null;
    } finally {
      active.printing = false;
    }
  }

  async print(sender: WebContents, id: unknown, index: unknown): Promise<Uint8Array | null> {
    const active = this.own(sender);
    if (
      !active ||
      typeof index !== 'number' ||
      !active.taken ||
      active.job.id !== id ||
      active.next !== index ||
      active.printing ||
      active.fresh
    )
      return null;
    const page = active.job.pages[index];
    if (page?.kind !== 'native') return null;
    active.printing = true;
    try {
      // The hidden page uses point-sized CSS paper and the common native slide renderer.
      const data = await active.win.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: false,
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        generateTaggedPDF: false,
        generateDocumentOutline: false,
      });
      if (
        this.own(sender) !== active ||
        !data.subarray(0, 5).equals(Buffer.from('%PDF-')) ||
        data.length > LIMIT
      )
        return null;
      active.fresh = { index, data: new Uint8Array(data) };
      return active.fresh.data;
    } catch {
      active.finish(null);
      return null;
    } finally {
      active.printing = false;
    }
  }

  async normalized(
    sender: WebContents,
    id: unknown,
    index: unknown,
    raw: unknown,
  ): Promise<Uint8Array | null> {
    const active = this.own(sender);
    const checked = z.array(printPageSchema).length(1).safeParse(raw);
    if (
      !active ||
      typeof index !== 'number' ||
      active.job.id !== id ||
      active.next !== index ||
      !checked.success ||
      active.printing ||
      active.fresh?.index !== index
    )
      return null;
    const page = active.job.pages[index];
    if (page?.kind !== 'native') return null;
    const fresh = active.fresh;
    active.fresh = null;
    active.printing = true;
    try {
      const bytes = await this.deps.normalize(fresh.data, checked.data, page.slide, active.signal);
      if (this.own(sender) !== active || bytes.length > LIMIT) return null;
      active.next = nextNative(active.job.pages, index + 1);
      return bytes;
    } catch {
      active.finish(null);
      return null;
    } finally {
      active.printing = false;
    }
  }

  done(sender: WebContents, raw: unknown): boolean {
    const active = this.own(sender);
    const checked = finishedSchema.safeParse(raw);
    if (!active || !checked.success || checked.data.id !== active.job.id) return false;
    const value = checked.data;
    if (value.error) {
      active.finish(null);
      return true;
    }
    if (
      active.next !== active.job.pages.length ||
      active.printing ||
      active.fresh ||
      !value.data ||
      value.pages?.length !== active.job.pages.length ||
      !Buffer.from(value.data.subarray(0, 5)).equals(Buffer.from('%PDF-'))
    ) {
      active.finish(null);
      return false;
    }
    for (const [index, page] of active.job.pages.entries()) {
      const actual = value.pages[index];
      if (
        page.kind === 'native' &&
        (actual?.width !== page.slide.width || actual.height !== page.slide.height)
      ) {
        active.finish(null);
        return false;
      }
    }
    active.finish(value.data);
    return true;
  }

  async asset(sender: WebContents, kind: unknown, name: unknown): Promise<Uint8Array | null> {
    if (
      !this.own(sender) ||
      (kind !== 'standardFontDataUrl' && kind !== 'wasmUrl' && kind !== 'cMapUrl') ||
      typeof name !== 'string' ||
      !PICTURE_ASSET_NAME.test(name) ||
      name.startsWith('.')
    )
      return null;
    for (const dir of this.deps.assetDirs(kind)) {
      try {
        return new Uint8Array(await readFile(join(dir, name)));
      } catch {
        /* Try the packaged fallback. */
      }
    }
    return null;
  }

  stop(): void {
    this.active?.finish(null);
  }
}

function nextNative(pages: PdfCopyPage[], start: number): number {
  for (let index = start; index < pages.length; index++) if (pages[index]?.kind === 'native') return index;
  return pages.length;
}
