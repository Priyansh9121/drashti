import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { PicturesResult } from '../../shared/pictures';
import {
  nowWithin,
  SABHA_FLOW_LIMITS,
  sabhaFlowReadingSchema,
  sabhaFlowSchema,
  UNREADABLE_READING,
  type SabhaFlow,
  type SabhaFlowChoice,
  type SabhaFlowNowResult,
  type SabhaFlowSnapshot,
} from '../../shared/sabha-flow';
import { cutText } from '../../shared/text';

/*
 * Sabha flow (alpha.23): Main's store. One current flow: the PDF the operator chose, as Drashti's own copy in the
 * data folder (`<data>/sabha-flow/<id>/source.pdf`), its pages drawn once by the pictures window at their own shape
 * (`page-0001.png`, …), what its text layer reads as, and where the sabha is (Now). The pictures window reads the text
 * (renderer/src/pictures/flow-reading.ts): Main never parses a PDF's words, it only checks the reading it is handed
 * (review M1). The record (`current.json`) is written whole each time (a new file, then renamed over the old), so a
 * stop at any moment leaves the old record or the new one. A choice's keeping, Now and Remove run one after another,
 * each whole (review S6); Remove, or another PDF chosen, stops a drawing still under way (S7). Replace makes a new
 * flow (a new id, Now back to none) and removes the old one's folder; Remove leaves nothing. Nothing is logged of the
 * file's name or its words.
 */

export interface SabhaFlowStoreDeps {
  /** The folder the flow is kept in (the data folder's `sabha-flow`). */
  dir: string;
  /** Draw the PDF's pages into `outDir`; the window hands back its reading too (PdfPictures.drawForFlow). */
  draw(pdf: string, outDir: string, signal?: AbortSignal): Promise<PicturesResult>;
  /** The flow or Now changed: to the operator window and the paired phones. */
  changed(snapshot: SabhaFlowSnapshot): void;
  log(message: string): void;
  /** A new flow's id (tests give their own). */
  newId?: () => string;
  /** Tests only: a moment inside each record's writing (its new file written, not yet renamed over the old). */
  whileWriting?: () => Promise<void>;
}

/**
 * The room a flow's page is drawn in: each page as large as fits, its own shape kept (an A4 page 1414 × 2000), sharp
 * enough to zoom into on the panel and a phone.
 */
export const FLOW_PAGE_ROOM = { width: 2000, height: 2000 } as const;

const RECORD = 'current.json';
const SOURCE = 'source.pdf';
const pageName = (index: number) => `page-${String(index + 1).padStart(4, '0')}.png`;

interface Current {
  flow: SabhaFlow;
  now: number | null;
  /** The pages drawn (from 0): those that can be shown. */
  pages: number[];
}

const recordSchema = z.object({
  version: z.literal(1),
  flow: sabhaFlowSchema,
  now: z.number().int().min(0).nullable(),
  pages: z
    .array(
      z
        .number()
        .int()
        .min(0)
        .max(SABHA_FLOW_LIMITS.maxPages - 1),
    )
    .max(SABHA_FLOW_LIMITS.maxPages),
});

const idSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/u);
const pageSchema = z
  .number()
  .int()
  .min(0)
  .max(SABHA_FLOW_LIMITS.maxPages - 1);
const nowSchema = z
  .number()
  .int()
  .min(0)
  .max(SABHA_FLOW_LIMITS.maxItems - 1)
  .nullable();

const NOT_A_PDF = 'That file is not a PDF: choose the running order saved as a PDF.';
const NOT_THERE = 'The PDF could not be read: it may have been moved or deleted. Choose it again.';
const TOO_BIG = `That PDF is too big for a Sabha flow (over ${String(SABHA_FLOW_LIMITS.maxPdfBytes / 1024 / 1024)} MB): save it again with smaller pictures.`;
const STALE = 'The Sabha flow has been replaced since: Now was not moved.';
const NO_ITEM = 'There is no such item in the Sabha flow.';
const CANCELLED = 'Cancelled.';

export class SabhaFlowStore {
  private current: Current | null = null;
  /** The choice under way (its drawing), stopped by Remove or by another choice. */
  private choosing: AbortController | null = null;
  /** A choice's keeping, Now and Remove: one after another, each whole. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: SabhaFlowStoreDeps) {}

  /** At start: the flow kept last time, if its record and copy are whole; anything else in the folder is cleared. */
  async load(): Promise<void> {
    let current: Current | null = null;
    try {
      const parsed = recordSchema.safeParse(JSON.parse(await readFile(join(this.deps.dir, RECORD), 'utf8')));
      if (parsed.success) {
        const { flow, now, pages } = parsed.data;
        await stat(join(this.deps.dir, flow.id, SOURCE));
        current = { flow, now: nowWithin(flow, now), pages };
      } else this.deps.log('Sabha flow: the kept record could not be read; starting with none.');
    } catch {
      // None kept (or its copy is gone): none.
    }
    this.current = current;
    await this.clearExcept(current?.flow.id ?? null, current !== null);
  }

  snapshot(): SabhaFlowSnapshot {
    const c = this.current;
    return c ? { flow: c.flow, state: { flowId: c.flow.id, now: c.now } } : { flow: null, state: null };
  }

  /** "Choose PDF…" (and Replace): the operator's file, copied, drawn and read; the current flow once it is. */
  async choose(file: unknown): Promise<SabhaFlowChoice> {
    if (typeof file !== 'string' || file === '' || !/\.pdf$/iu.test(file))
      return { ok: false, message: NOT_A_PDF };
    // Another PDF chosen: the one before stops.
    this.choosing?.abort();
    const stop = new AbortController();
    this.choosing = stop;
    try {
      return await this.chooseNow(file, stop.signal);
    } finally {
      if (this.choosing === stop) this.choosing = null;
    }
  }

  private async chooseNow(file: string, signal: AbortSignal): Promise<SabhaFlowChoice> {
    try {
      const info = await stat(file);
      if (!info.isFile()) return { ok: false, message: NOT_THERE };
      if (info.size > SABHA_FLOW_LIMITS.maxPdfBytes) return { ok: false, message: TOO_BIG };
      const handle = await open(file, 'r');
      try {
        const head = Buffer.alloc(5);
        await handle.read(head, 0, 5, 0);
        if (head.toString('latin1') !== '%PDF-') return { ok: false, message: NOT_A_PDF };
      } finally {
        await handle.close();
      }
    } catch {
      return { ok: false, message: NOT_THERE };
    }
    const id = this.deps.newId?.() ?? randomUUID();
    const folder = join(this.deps.dir, id);
    const drop = () => rm(folder, { recursive: true, force: true }).catch(() => undefined);
    // Asked afresh each time: Remove, or another choice, may stop it while this one waits on the disk or the drawing.
    const stopped = () => signal.aborted;
    const source = join(folder, SOURCE);
    try {
      await mkdir(folder, { recursive: true });
      await copyFile(file, source);
    } catch {
      await drop();
      return {
        ok: false,
        message: 'Drashti could not keep a copy of the PDF: check there is room on the disk.',
      };
    }
    if (stopped()) {
      await drop();
      return { ok: false, message: CANCELLED };
    }
    const drawn = await this.deps.draw(source, folder, signal);
    if (stopped() || !drawn.ok) {
      await drop();
      return { ok: false, message: drawn.ok || stopped() ? CANCELLED : drawn.message };
    }
    const pages = [...drawn.pages].sort((a, b) => a.index - b.index);
    // What the pictures window read, as checked; none, or none that passes: unreadable (its pages are shown), and the
    // log says which (never the PDF's name or words).
    const read = sabhaFlowReadingSchema.safeParse(drawn.flowReading);
    const reading = read.success ? read.data : { ...UNREADABLE_READING };
    if (!read.success) {
      const why =
        drawn.flowReadProblem === 'crashed'
          ? 'the reader in the pictures window stopped with an error'
          : drawn.flowReadProblem === 'failed-check' || drawn.flowReading !== undefined
            ? 'the reading failed its check'
            : 'no reading came from the pictures window';
      this.deps.log(`Sabha flow: its words were not read (${why}): shown as unreadable, its pages shown`);
    }
    let last = -1;
    for (const p of pages) if (p.index > last) last = p.index;
    const checked = sabhaFlowSchema.safeParse({
      id,
      fileName: cutText(basename(file), SABHA_FLOW_LIMITS.maxFileName),
      pageCount: drawn.total,
      drawnPages: last + 1,
      ...reading,
    });
    if (!checked.success) {
      await drop();
      return {
        ok: false,
        message: 'The PDF could not be read as a Sabha flow: save it again and choose it again.',
      };
    }
    const flow = checked.data;
    return this.inTurn(async (): Promise<SabhaFlowChoice> => {
      // Removed, or another PDF chosen, while this one was being drawn.
      if (stopped()) {
        await drop();
        return { ok: false, message: CANCELLED };
      }
      const before = this.current;
      const next: Current = { flow, now: null, pages: pages.map((p) => p.index) };
      try {
        await this.write(next);
      } catch {
        await drop();
        return {
          ok: false,
          message: 'Drashti could not keep the Sabha flow: check there is room on the disk.',
        };
      }
      this.current = next;
      if (before && before.flow.id !== id)
        await rm(join(this.deps.dir, before.flow.id), { recursive: true, force: true }).catch(
          () => undefined,
        );
      this.deps.log(
        `Sabha flow: a PDF was chosen (${String(flow.pageCount)} page(s), ${String(flow.drawnPages)} drawn, ${String(flow.items.length)} item(s), ${flow.status}, ${flow.lang})`,
      );
      this.deps.changed(this.snapshot());
      return { ok: true, flow };
    });
  }

  /** Remove: no flow, its copy, pages and record gone; a choice under way stops. */
  remove(): Promise<null> {
    this.choosing?.abort();
    return this.inTurn(async () => {
      const before = this.current;
      this.current = null;
      await rm(join(this.deps.dir, RECORD), { force: true }).catch(() => undefined);
      if (before) {
        await rm(join(this.deps.dir, before.flow.id), { recursive: true, force: true }).catch(
          () => undefined,
        );
        this.deps.log('Sabha flow: removed');
        this.deps.changed(this.snapshot());
      }
      return null;
    });
  }

  /** Mark Now: an index into the current flow's items, or null; refused for a flow that is no longer current. */
  setNow(flowId: unknown, now: unknown): Promise<SabhaFlowNowResult> {
    return this.inTurn(async (): Promise<SabhaFlowNowResult> => {
      const c = this.current;
      if (!c || typeof flowId !== 'string' || flowId !== c.flow.id) return { ok: false, message: STALE };
      const parsed = nowSchema.safeParse(now);
      if (!parsed.success || (parsed.data !== null && parsed.data >= c.flow.items.length))
        return { ok: false, message: NO_ITEM };
      const next: Current = { ...c, now: parsed.data };
      this.current = next;
      try {
        await this.write(next);
      } catch {
        this.deps.log('Sabha flow: Now could not be kept for the next start');
      }
      this.deps.changed(this.snapshot());
      return { ok: true, state: { flowId: c.flow.id, now: parsed.data } };
    });
  }

  /** A page of the current flow (from 0) as its PNG, or null. */
  async page(flowId: unknown, page: unknown): Promise<Uint8Array | null> {
    const file = this.pageFile(flowId, page);
    if (!file) return null;
    try {
      return new Uint8Array(await readFile(file));
    } catch {
      return null;
    }
  }

  /** The PNG file of a page of the current flow (for the phone's route), or null. */
  pageFile(flowId: unknown, page: unknown): string | null {
    const c = this.current;
    if (!c || !idSchema.safeParse(flowId).success || flowId !== c.flow.id) return null;
    const at = pageSchema.safeParse(page);
    if (!at.success || !c.pages.includes(at.data)) return null;
    return join(this.deps.dir, c.flow.id, pageName(at.data));
  }

  /** Run `work` after everything before it, whole: no change starts while another is part done. */
  private inTurn<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async write(current: Current): Promise<void> {
    await mkdir(this.deps.dir, { recursive: true });
    const record = { version: 1, flow: current.flow, now: current.now, pages: current.pages };
    const temp = join(this.deps.dir, `${RECORD}.${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify(record));
    await this.deps.whileWriting?.();
    await rename(temp, join(this.deps.dir, RECORD));
  }

  /** Everything in the folder but the kept flow and its record (what a stopped choice or an old flow left). */
  private async clearExcept(id: string | null, keepRecord: boolean): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.deps.dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === id || (keepRecord && name === RECORD)) continue;
      await rm(join(this.deps.dir, name), { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
