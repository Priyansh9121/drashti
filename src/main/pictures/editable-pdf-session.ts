import type { BrowserWindow, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants, setPriority } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  EDITABLE_SOURCE_LIMITS,
  type EditablePdfJob,
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
const failure = (): PreparedSource => ({
  ok: false,
  message: 'Source pages could not be prepared safely. Saved playback is unchanged.',
});

interface Session {
  win: BrowserWindow;
  request: SourceRead;
  job: EditablePdfJob;
  requested: Set<number>;
  pages: Map<number, PreparedSourcePage>;
  assetBytes: number;
  metadataBytes: number;
  accepting: boolean;
  stopped: boolean;
  writes: Promise<void>;
  finish(result: PreparedSource): void;
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
        finish({ ok: false, message: 'Source preparation cancelled. Saved playback is unchanged.' });
      const timer = setTimeout(() => finish(failure()), sourceTimeLeft(request));
      const session: Session = {
        win,
        request,
        job: {
          mode: 'editable-source',
          jobId: randomUUID(),
          data,
          sourcePages: [...requested],
          limits: EDITABLE_SOURCE_LIMITS,
        },
        requested,
        pages: new Map(),
        assetBytes: 0,
        metadataBytes: 0,
        accepting: false,
        stopped: false,
        writes: Promise.resolve(),
        finish: (result) => finish(result),
      };
      const finish = (result: PreparedSource) => {
        if (finished) return;
        finished = true;
        session.stopped = true;
        clearTimeout(timer);
        request.signal.removeEventListener('abort', abort);
        if (this.active === session) this.active = null;
        if (!win.isDestroyed()) win.destroy();
        // Main may already be writing a PNG; caller must not remove the output folder until it settles.
        void session.writes.then(
          () => resolve(result),
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
    return this.owns(sender) ? (this.active?.job ?? null) : null;
  }

  async page(sender: WebContents, raw: unknown): Promise<boolean> {
    const session = this.active;
    if (!session || !this.owns(sender) || this.isStopped(session)) return false;
    if (session.accepting) {
      session.finish(failure());
      return false;
    }
    session.accepting = true;
    const accepted = Promise.resolve().then(async () => {
      try {
        const checkpoint = checkpointSchema.safeParse(raw);
        if (checkpoint.success) {
          if (
            checkpoint.data.jobId !== session.job.jobId ||
            !session.requested.has(checkpoint.data.sourceIndex)
          ) {
            session.finish(failure());
            return false;
          }
          if (await sourceCheckpoint(session.request)) return !this.isStopped(session);
          session.finish(failure());
          return false;
        }
        const parsed = validateEditablePdfPage(raw, session.job.jobId, session.requested);
        if (
          !parsed ||
          session.pages.has(parsed.page.sourceIndex) ||
          session.assetBytes + parsed.assetBytes > EDITABLE_SOURCE_LIMITS.jobAssetBytes ||
          session.metadataBytes + parsed.metadataBytes > EDITABLE_SOURCE_LIMITS.jobMetadataBytes
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
        const assets: PreparedSourcePage['assets'] = [];
        for (const asset of parsed.page.assets) {
          if (this.isStopped(session) || this.isAborted(session.request)) return false;
          const file = join(session.request.outDir, `${randomUUID()}.png`);
          await writeFile(file, asset.png, { flag: 'wx', mode: 0o600 });
          assets.push({ token: asset.token, file, kind: 'image' });
        }
        if (this.isStopped(session)) return false;
        session.pages.set(parsed.page.sourceIndex, {
          sourceIndex: parsed.page.sourceIndex,
          width: parsed.page.width,
          height: parsed.page.height,
          background: '#ffffff',
          elements: parsed.page.elements,
          assets,
          issues: parsed.page.issues,
        });
        session.assetBytes += parsed.assetBytes;
        session.metadataBytes += parsed.metadataBytes;
        return true;
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
      [...session.requested].some((index) => !session.pages.has(index) && !failed.has(index))
    ) {
      session.finish(failure());
      return;
    }
    session.finish({
      ok: true,
      pages: [...session.pages.values()].sort((a, b) => a.sourceIndex - b.sourceIndex),
      total: parsed.data.total,
      failed: [...failed].sort((a, b) => a - b),
    });
  }

  stop(): void {
    this.active?.finish(failure());
  }
}
