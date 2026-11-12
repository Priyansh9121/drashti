import type { BrowserWindow, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { constants, setPriority } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { CapturedPicture, PdfCopyJob, PdfCopyPage, PdfPrintPage } from '../../shared/pdf-copy';
import { PICTURE_ASSET_NAME, type PictureAssetKind } from '../../shared/pictures';

const LIMIT = 64 * 1024 * 1024;
const PICTURE_LONG_SIDE = 1920;
/** The most a phone's picture may hold as pixels: 3840 x 2160, a 1920 x 1080 slide on a display at twice the size. */
const PICTURE_PIXELS_LIMIT = 3840 * 2160 * 4;
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
  /** The scale of the display that contains the hidden window. */
  scaleFactor?(win: BrowserWindow): number;
  assetDirs(kind: PictureAssetKind): string[];
  /** Runs only on bytes just printed here; the output geometry worker never receives imported PDFs. */
  normalize(
    data: Uint8Array,
    pages: PdfPrintPage[],
    target: { width: number; height: number },
    signal: AbortSignal,
  ): Promise<Uint8Array>;
  /** The byte order of a captured picture's pixels on this computer (index.ts finds it); left out, blue first. */
  pixelOrder?(): CapturedPicture['order'];
}
interface ActiveCopy {
  win: BrowserWindow;
  job: PdfCopyJob;
  pictureLongSide: number;
  signal: AbortSignal;
  current(): boolean;
  finish(data: Uint8Array | CapturedPicture | null): void;
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

  async picture(
    slide: Extract<PdfCopyJob['pages'][number], { kind: 'native' }>['slide'],
    looks: NonNullable<PdfCopyJob['picture']>['looks'],
    current: () => boolean,
    signal: AbortSignal,
  ): Promise<CapturedPicture | null> {
    const scale = PICTURE_LONG_SIDE / Math.max(slide.width, slide.height);
    const out = await this.start(
      { pages: [{ kind: 'native', slide }], sources: [], picture: { scale, looks } },
      current,
      signal,
    );
    return out instanceof Uint8Array ? null : out;
  }

  async run(
    plan: Omit<PdfCopyJob, 'id'>,
    current: () => boolean,
    signal: AbortSignal,
  ): Promise<Uint8Array | null> {
    const out = await this.start(plan, current, signal);
    return out instanceof Uint8Array ? out : null;
  }

  private async start(
    plan: Omit<PdfCopyJob, 'id'>,
    current: () => boolean,
    signal: AbortSignal,
  ): Promise<Uint8Array | CapturedPicture | null> {
    if (!plan.pages.length || plan.pages.length > MAX_PAGES) return null;
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
    if (signal.aborted || !current()) return null;
    // A phone's picture is the lowest of this window's jobs (C6's review, LOW 1): the operator's copy ends it (the
    // phone gets the slide as it starts) and goes ahead, while a picture never waits for another job.
    if (this.active?.job.picture && !plan.picture) this.active.finish(null);
    if (this.active) return null;
    const picture = plan.picture;
    let opened: BrowserWindow | undefined;
    let pictureLongSide = Infinity;
    try {
      opened = this.deps.open();
      if (picture) {
        const displayScale = this.deps.scaleFactor?.(opened) ?? 1;
        const factor = Number.isFinite(displayScale) ? Math.max(1, displayScale) : 1;
        pictureLongSide = Math.max(1, Math.floor(PICTURE_LONG_SIDE / factor));
      }
    } catch {
      if (opened && !opened.isDestroyed()) opened.destroy();
      return null;
    }
    const win = opened;
    return new Promise((resolve) => {
      let ended = false;
      const finish = (data: Uint8Array | CapturedPicture | null) => {
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
        job: {
          ...plan,
          ...(picture
            ? { picture: { ...picture, scale: (picture.scale * pictureLongSide) / PICTURE_LONG_SIDE } }
            : {}),
          id: randomUUID(),
        },
        pictureLongSide,
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
      const timer = setTimeout(abort, plan.picture ? 8_000 : DEADLINE_MS);
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
    // A phone's picture that cannot be made ends at once: the phone gets the slide as it starts without waiting out
    // the job's time (C6's review, LOW 4).
    const refuse = () => {
      if (active.job.picture) active.finish(null);
      return null;
    };
    const page = active.job.pages[index];
    if (page?.kind !== 'native') return refuse();
    const scale = active.job.picture?.scale ?? 4 / 3;
    const width = Math.min(active.pictureLongSide, Math.ceil(page.slide.width * scale));
    const height = Math.min(active.pictureLongSide, Math.ceil(page.slide.height * scale));
    // Bound viewport and screenshot memory as well as compressed output bytes.
    if (width * height > 4_000_000) return refuse();
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
      if (this.own(sender) !== active) return null;
      if (image.isEmpty()) return refuse();
      if (active.job.picture) {
        // Never encoded on Main's thread (C6's review, MEDIUM 1): its pixels as captured (a copy) go on to the
        // network's process, which makes the PNG. The hidden page is told nothing back.
        const { width: wide, height: high } = image.getSize();
        const bytes = wide * high * 4;
        if (wide < 1 || high < 1 || !Number.isSafeInteger(bytes) || bytes > PICTURE_PIXELS_LIMIT)
          return refuse();
        const pixels = image.toBitmap();
        if (pixels.length !== bytes) return refuse();
        active.finish({
          width: wide,
          height: high,
          pixels: new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.length),
          order: this.deps.pixelOrder?.() ?? 'bgra',
        });
        return null;
      }
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
      active.job.picture ||
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
      active.job.picture ||
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
    if (active.job.picture || value.error) {
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
