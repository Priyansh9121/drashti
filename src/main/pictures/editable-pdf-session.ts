import type { BrowserWindow, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants, setPriority } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  EDITABLE_SOURCE_LIMITS,
  type EditablePdfJob,
  type PdfPageReceipt,
  type PreparedSource,
  type PreparedSourcePage,
} from '../../shared/editable-source';
import { sourceCheckpoint, sourceTimeLeft, type SourceRead } from '../documents/source-reader';
import { validateEditablePdfPage } from './editable-pdf-validation';

const checkpointSchema = z
  .object({
    mode: z.literal('editable-checkpoint'),
    jobId: z.string().max(512),
    sourceIndex: z.number().int().min(0),
    total: z.number().int().min(1).max(1_000_000).optional(),
  })
  .strict();
const doneSchema = z
  .object({
    mode: z.literal('editable-source'),
    jobId: z.string().max(512),
    total: z.number().int().min(0).max(1_000_000),
    failed: z.array(z.number().int().min(0)).max(EDITABLE_SOURCE_LIMITS.pages),
    error: z.string().max(300).optional(),
  })
  .strict();
/*
 * The hidden window's reply for one page, as its protocol has it (Session 57): this job, a page asked for, and each
 * field of its kind, its lists no longer than any page's (the page reader stops at 500 painted objects, each one
 * element and at most one picture, and says at most five things: pdf-edit-page.ts). A reply that breaks the protocol
 * stops the whole job, as before, so Main never reads an over-long list twice. One whose page fails Main's own checks
 * (validateEditablePdfPage: its size, its words and shapes, its pictures and their bytes) leaves only that page as its
 * saved picture, as a page over the output budget does: the rest of the PDF is still made editable.
 */
const pageReplySchema = z
  .object({
    mode: z.literal('editable-source'),
    jobId: z.string().max(512),
    sourceIndex: z.number().int().min(0),
    width: z.number(),
    height: z.number(),
    elements: z.array(z.unknown()).max(EDITABLE_SOURCE_LIMITS.pageElements),
    assets: z
      .array(z.object({ token: z.string(), png: z.instanceof(Uint8Array) }))
      .max(EDITABLE_SOURCE_LIMITS.pageElements),
    issues: z.array(z.unknown()).max(100),
  })
  .strict();
const failure = (): PreparedSource => ({
  ok: false,
  message: 'This PDF’s words and shapes could not be read safely. The slides still show as before.',
});

// Return completed pages before the outer source queue expires and cancels its request.
const PDF_FINISH_RESERVE_MS = 2_000;

interface Session {
  win: BrowserWindow;
  request: SourceRead;
  job: EditablePdfJob;
  requested: Set<number>;
  pages: Map<number, PreparedSourcePage>;
  skipped: Set<number>;
  total: number | null;
  deadlineAt: number;
  assetBytes: number;
  metadataBytes: number;
  accepting: boolean;
  stopped: boolean;
  writes: Promise<void>;
  finish(result: PreparedSource): void;
}

function completed(
  session: Session,
  total: number,
  failed: Iterable<number>,
  unread?: number[],
): PreparedSource {
  return {
    ok: true,
    pages: [...session.pages.values()].sort((a, b) => a.sourceIndex - b.sourceIndex),
    total,
    failed: [...failed].sort((a, b) => a - b),
    ...(unread ? { unread } : {}),
  };
}

export class EditablePdfSessions {
  private active: Session | null = null;
  private current(): Session | null {
    return this.active;
  }
  private isStopped(session: Session): boolean {
    return session.stopped;
  }
  private isAborted(request: SourceRead): boolean {
    return request.signal.aborted;
  }
  /*
   * The show needs the computer (Session 57, the lead's review of C2's part 1, HIGH-1): the job ends here instead of
   * waiting, so none of its clocks (Main's, the reader queue's, the hidden window's own and each page's) runs on
   * through the show, and PdfPictures' one queue is free for an import's pictures meanwhile. What is read stays read;
   * the pages not read yet are left `unread`, never failed, for a new job once the show is idle (imported-slides.ts).
   */
  private hold(session: Session): false {
    if (session.total === null) {
      // A window that never said how many pages there are: nothing to go on from, as before.
      session.finish(failure());
      return false;
    }
    const unread = session.job.sourcePages.filter(
      (index) => !session.pages.has(index) && !session.skipped.has(index),
    );
    session.finish(completed(session, session.total, session.skipped, unread));
    return false;
  }
  /** What Main keeps of a page counts against the job's budgets and, shared, against the PDF's (`pdfBudget`). */
  private spend(session: Session, assetBytes: number, metadataBytes: number): void {
    session.assetBytes += assetBytes;
    session.metadataBytes += metadataBytes;
    const shared = session.request.pdfBudget;
    if (shared) {
      shared.assetBytes = session.assetBytes;
      shared.metadataBytes = session.metadataBytes;
    }
  }
  constructor(private readonly open: () => BrowserWindow) {}

  /** Called only by PdfPictures' shared serial queue, not directly by a renderer. */
  async readNow(request: SourceRead): Promise<PreparedSource> {
    if (
      this.current() ||
      request.ext !== 'pdf' ||
      this.isAborted(request) ||
      !(await sourceCheckpoint(request))
    )
      return failure();
    const requested = new Set(request.sourcePages);
    if (
      !requested.size ||
      requested.size > EDITABLE_SOURCE_LIMITS.pages ||
      requested.size !== request.sourcePages.length ||
      [...requested].some((index) => !Number.isInteger(index) || index < 0 || index > 1_000_000)
    )
      return failure();
    let data: Uint8Array;
    try {
      // Preparation is bounded independently of ordinary full-page picture imports.
      const size = await stat(request.file);
      if (!size.isFile() || size.size > 128 * 1024 * 1024) return failure();
      data = new Uint8Array(await readFile(request.file, { signal: request.signal }));
      if (data.byteLength !== size.size) return failure();
      await mkdir(request.outDir, { recursive: true });
    } catch {
      return failure();
    }
    if (this.isAborted(request) || !(await sourceCheckpoint(request))) return failure();
    if (this.current()) return failure();
    return new Promise<PreparedSource>((resolve) => {
      let win: BrowserWindow;
      try {
        win = this.open();
      } catch {
        resolve(failure());
        return;
      }
      let finished = false;
      const abort = () =>
        finish({
          ok: false,
          message: 'Reading the original’s words and shapes was stopped. The slides still show as before.',
        });
      const timeBudgetMs = Math.max(1, sourceTimeLeft(request) - PDF_FINISH_RESERVE_MS);
      const deadlineAt = performance.now() + timeBudgetMs;
      const timer = setTimeout(() => {
        if (this.isAborted(request) || session.total === null || !session.pages.size) {
          finish(failure());
          return;
        }
        const failed = [...session.requested].filter((index) => !session.pages.has(index));
        finish(completed(session, session.total, failed));
      }, timeBudgetMs);
      const closed = new AbortController();
      const session: Session = {
        win,
        request: { ...request, signal: AbortSignal.any([request.signal, closed.signal]) },
        job: {
          mode: 'editable-source',
          jobId: randomUUID(),
          data,
          sourcePages: [...requested],
          limits: EDITABLE_SOURCE_LIMITS,
          timeBudgetMs,
        },
        requested,
        pages: new Map(),
        skipped: new Set(),
        total: null,
        deadlineAt,
        // One PDF's jobs share its budgets (a job ended for the show is followed by another).
        assetBytes: request.pdfBudget?.assetBytes ?? 0,
        metadataBytes: request.pdfBudget?.metadataBytes ?? 0,
        accepting: false,
        stopped: false,
        writes: Promise.resolve(),
        finish: (result) => finish(result),
      };
      const finish = (result: PreparedSource) => {
        if (finished) return;
        finished = true;
        session.stopped = true;
        closed.abort();
        clearTimeout(timer);
        request.signal.removeEventListener('abort', abort);
        if (this.active === session) this.active = null;
        if (!win.isDestroyed()) win.destroy();
        // Main may already be writing a PNG; caller must not remove the output folder until it settles.
        void session.writes.then(
          () => resolve(result.ok && this.isAborted(request) ? failure() : result),
          () => resolve(failure()),
        );
      };
      this.active = session;
      request.signal.addEventListener('abort', abort, { once: true });
      win.webContents.once('render-process-gone', () => finish(failure()));
      win.once('closed', () => finish(failure()));
      win.webContents.once('dom-ready', () => {
        try {
          setPriority(win.webContents.getOSProcessId(), constants.priority.PRIORITY_LOW);
        } catch {
          /* Remains normal if disallowed. */
        }
      });
      if (this.isAborted(request)) abort();
    });
  }

  owns(sender: WebContents): boolean {
    return this.active?.win.webContents.id === sender.id;
  }

  job(sender: WebContents): EditablePdfJob | null {
    const session = this.active;
    if (!session || !this.owns(sender)) return null;
    return { ...session.job, timeBudgetMs: Math.max(0, session.deadlineAt - performance.now()) };
  }

  async page(sender: WebContents, raw: unknown): Promise<PdfPageReceipt> {
    const session = this.active;
    if (!session || !this.owns(sender) || this.isStopped(session)) return false;
    if (session.accepting) {
      session.finish(failure());
      return false;
    }
    session.accepting = true;
    const accepted = Promise.resolve().then(async (): Promise<PdfPageReceipt> => {
      try {
        const checkpoint = checkpointSchema.safeParse(raw);
        if (checkpoint.success) {
          const { jobId, sourceIndex, total } = checkpoint.data;
          if (
            jobId !== session.job.jobId ||
            !session.requested.has(sourceIndex) ||
            (total !== undefined &&
              (session.total === null
                ? [...session.pages.keys()].some((index) => index >= total)
                : session.total !== total))
          ) {
            session.finish(failure());
            return false;
          }
          if (await sourceCheckpoint(session.request)) {
            if (this.isStopped(session)) return false;
            if (total !== undefined) session.total = total;
            return session.request.pdfHold?.() ? this.hold(session) : true;
          }
          session.finish(failure());
          return false;
        }
        const reply = pageReplySchema.safeParse(raw);
        if (
          !reply.success ||
          reply.data.jobId !== session.job.jobId ||
          !session.requested.has(reply.data.sourceIndex) ||
          session.pages.has(reply.data.sourceIndex) ||
          session.skipped.has(reply.data.sourceIndex) ||
          (session.request.onPdfPage !== undefined && session.total === null) ||
          (session.total !== null && reply.data.sourceIndex >= session.total)
        ) {
          session.finish(failure());
          return false;
        }
        if (
          !(await sourceCheckpoint(session.request)) ||
          this.isStopped(session) ||
          this.isAborted(session.request)
        ) {
          session.finish(failure());
          return false;
        }
        // A page that arrives as the show needs the computer is neither checked nor written: it is read again later.
        if (session.request.pdfHold?.()) return this.hold(session);
        const parsed = validateEditablePdfPage(raw, session.job.jobId, session.requested);
        if (
          !parsed ||
          session.assetBytes + parsed.assetBytes > EDITABLE_SOURCE_LIMITS.jobAssetBytes ||
          session.metadataBytes + parsed.metadataBytes > EDITABLE_SOURCE_LIMITS.jobMetadataBytes
        ) {
          // A page failing Main's checks, or one past the remaining output budget, keeps its saved picture.
          session.skipped.add(reply.data.sourceIndex);
          await session.request.onPdfPage?.(reply.data.sourceIndex);
          if (this.isStopped(session)) return false;
          return session.request.pdfHold?.() ? this.hold(session) : 'skipped';
        }
        const assets: PreparedSourcePage['assets'] = [];
        for (const asset of parsed.page.assets) {
          if (this.isStopped(session) || this.isAborted(session.request)) return false;
          const file = join(session.request.outDir, `${randomUUID()}.png`);
          await writeFile(file, asset.png, { flag: 'wx', mode: 0o600 });
          assets.push({ token: asset.token, file, kind: 'image' });
        }
        if (this.isStopped(session)) return false;
        const page: PreparedSourcePage = {
          sourceIndex: parsed.page.sourceIndex,
          width: parsed.page.width,
          height: parsed.page.height,
          background: '#ffffff',
          elements: parsed.page.elements,
          assets,
          issues: parsed.page.issues,
        };
        session.pages.set(page.sourceIndex, page);
        this.spend(session, parsed.assetBytes, parsed.metadataBytes);
        await session.request.onPdfPage?.(page.sourceIndex, page);
        if (this.isStopped(session)) return false;
        return session.request.pdfHold?.() ? this.hold(session) : true;
      } catch {
        session.finish(failure());
        return false;
      } finally {
        session.accepting = false;
      }
    });
    session.writes = accepted.then(
      () => undefined,
      () => undefined,
    );
    return accepted;
  }

  done(sender: WebContents, raw: unknown): void {
    const session = this.active;
    if (!session || !this.owns(sender)) return;
    const parsed = doneSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.jobId !== session.job.jobId ||
      (session.total !== null && session.total !== parsed.data.total) ||
      parsed.data.error ||
      session.accepting
    ) {
      session.finish(failure());
      return;
    }
    const failed = new Set(parsed.data.failed);
    if (
      failed.size !== parsed.data.failed.length ||
      [...failed].some((index) => !session.requested.has(index)) ||
      [...session.pages.keys()].some((index) => index >= parsed.data.total || failed.has(index)) ||
      [...session.requested].some(
        (index) => !session.pages.has(index) && !failed.has(index) && !session.skipped.has(index),
      )
    ) {
      session.finish(failure());
      return;
    }
    for (const index of session.skipped) failed.add(index);
    session.finish(completed(session, parsed.data.total, failed));
  }

  stop(): void {
    this.active?.finish(failure());
  }
}
