import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow, WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EDITABLE_SOURCE_LIMITS, type PreparedSourcePage } from '../../shared/editable-source';
import type { SourceRead } from '../documents/source-reader';
import { EditablePdfSessions } from './editable-pdf-session';

/*
 * The hidden window's session while Edit slides streams a big PDF's pages to the open editor (Session 57, C2 part 1;
 * the lead's review MEDIUM-3 and HIGH-1). Its rules stay as they were: every page checked by Main, a page that fails
 * Main's checks stays its picture and is handed on by its index alone, a reply that breaks the protocol ends the job,
 * cancelling wins. New: when the show needs the computer, the job ends at its next checkpoint or page with the pages
 * not yet read left unread (never failed), for a new job once the show is idle; and one PDF's jobs share its byte
 * budgets. Transport only: the hidden window is played by the test.
 */

class HiddenWindow extends EventEmitter {
  destroyed = false;
  webContents = Object.assign(new EventEmitter(), { id: 503, getOSProcessId: () => 2 ** 30 });
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
    this.emit('closed');
  }
}

const roots: string[] = [];
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Streamed = { index: number; page?: PreparedSourcePage };
type Extra = Partial<SourceRead> & Record<string, unknown>;

function setup(pages: number[], extra: (t: { handed: Streamed[]; stop: AbortController }) => Extra = () => ({})) {
  const root = mkdtempSync(join(tmpdir(), 'drashti-editable-pdf-streaming-'));
  roots.push(root);
  const file = join(root, 'Placeholder streaming.pdf');
  writeFileSync(file, '%PDF-1.4 Placeholder transport fixture');
  const outDir = join(root, 'generated');
  const stop = new AbortController();
  const win = new HiddenWindow();
  const session = new EditablePdfSessions(() => win as unknown as BrowserWindow);
  const sender = { id: win.webContents.id } as WebContents;
  const handed: Streamed[] = [];
  const request = {
    ext: 'pdf' as const,
    file,
    outDir,
    sourcePages: pages,
    signal: stop.signal,
    checkpoint: () => Promise.resolve(true),
    onPdfPage: (index: number, page?: PreparedSourcePage) => {
      handed.push({ index, ...(page ? { page } : {}) });
      return Promise.resolve();
    },
    ...extra({ handed, stop }),
  };
  const result = session.readNow(request as SourceRead);
  return { outDir, stop, win, session, sender, result, handed };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function jobOf(t: ReturnType<typeof setup>): Promise<string> {
  await vi.waitFor(() => expect(t.session.job(t.sender)).not.toBeNull(), { interval: 1 });
  const job = t.session.job(t.sender);
  if (!job) throw new Error('No editable source job.');
  return job.jobId;
}

const picture = {
  id: 'Placeholder picture',
  kind: 'image',
  mediaId: 'pdf-paint-1',
  fit: 'stretch',
  frame: { x: 10, y: 20, width: 80, height: 60 },
};
const page = (jobId: string, sourceIndex: number) => ({
  mode: 'editable-source',
  jobId,
  sourceIndex,
  width: 960,
  height: 540,
  elements: [picture],
  assets: [{ token: 'pdf-paint-1', png }],
  issues: [],
});
/** A page of one shape: nothing for Main to write. */
const shapes = (jobId: string, sourceIndex: number) => ({
  ...page(jobId, sourceIndex),
  elements: [
    {
      id: 'Placeholder shape',
      kind: 'shape',
      frame: { x: 10, y: 20, width: 80, height: 60 },
      fill: '#204060',
      cornerRadius: 0,
      opacity: 1,
    },
  ],
  assets: [],
});
const offPage = (jobId: string, sourceIndex: number) => ({
  ...page(jobId, sourceIndex),
  elements: [{ ...picture, frame: { ...picture.frame, x: 2_000_000 } }],
});
const checkpoint = (jobId: string, sourceIndex: number, total?: number) => ({
  mode: 'editable-checkpoint',
  jobId,
  sourceIndex,
  ...(total !== undefined ? { total } : {}),
});

describe('streaming a PDF’s pages to the open editor (Session 57, C2 part 1)', () => {
  it('hands on a page Main refuses by its index alone, and the next page still comes', async () => {
    const t = setup([0, 1, 2]);
    const jobId = await jobOf(t);
    expect(await t.session.page(t.sender, checkpoint(jobId, 0, 3))).toBe(true);
    expect(await t.session.page(t.sender, page(jobId, 0))).toBe(true);
    expect(await t.session.page(t.sender, offPage(jobId, 1))).toBe('skipped');
    expect(await t.session.page(t.sender, page(jobId, 2))).toBe(true);
    expect(t.handed.map(({ index, page: kept }) => [index, kept?.sourceIndex ?? null])).toEqual([
      [0, 0],
      [1, null],
      [2, 2],
    ]);
    t.session.done(t.sender, { mode: 'editable-source', jobId, total: 3, failed: [] });
    const prepared = await t.result;
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.pages.map((p) => p.sourceIndex)).toEqual([0, 2]);
    expect(prepared.failed).toEqual([1]);
    expect(readdirSync(t.outDir)).toHaveLength(2);
  });

  it('ends the whole job on a page sent before the page count, handing on and writing nothing', async () => {
    const t = setup([0, 1]);
    const jobId = await jobOf(t);
    expect(await t.session.page(t.sender, page(jobId, 0))).toBe(false);
    expect((await t.result).ok).toBe(false);
    expect(t.handed).toEqual([]);
    expect(readdirSync(t.outDir)).toEqual([]);
    expect(t.win.destroyed).toBe(true);
  });

  it('ends the job when cancelled while a page is handed on, and takes nothing more', async () => {
    const t = setup([0, 1, 2], ({ stop }) => ({
      onPdfPage: (index: number) => {
        if (index === 1) stop.abort();
        return Promise.resolve();
      },
    }));
    const jobId = await jobOf(t);
    expect(await t.session.page(t.sender, checkpoint(jobId, 0, 3))).toBe(true);
    expect(await t.session.page(t.sender, page(jobId, 0))).toBe(true);
    expect(await t.session.page(t.sender, page(jobId, 1))).toBe(false);
    expect(await t.session.page(t.sender, page(jobId, 2))).toBe(false);
    expect((await t.result).ok).toBe(false);
    expect(readdirSync(t.outDir)).toHaveLength(2);
    expect(t.win.destroyed).toBe(true);
  });

  it('at a hold after a page, ends the job with the rest unread, not failed, and writes nothing more', async () => {
    let held = false;
    const t = setup([0, 1, 2, 3], ({ handed }) => ({
      onPdfPage: (index: number, kept?: PreparedSourcePage) => {
        handed.push({ index, ...(kept ? { page: kept } : {}) });
        // Something goes up on the screens as page 1 reaches the editor.
        if (index === 1) held = true;
        return Promise.resolve();
      },
      pdfHold: () => held,
    }));
    const jobId = await jobOf(t);
    expect(await t.session.page(t.sender, checkpoint(jobId, 0, 4))).toBe(true);
    expect(await t.session.page(t.sender, page(jobId, 0))).toBe(true);
    expect(await t.session.page(t.sender, page(jobId, 1))).toBe(false);
    // The window has stopped; a late reply is refused and nothing of it is written.
    expect(await t.session.page(t.sender, page(jobId, 2))).toBe(false);
    const prepared = await t.result;
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared).toMatchObject({ total: 4, failed: [], unread: [2, 3] });
    expect(prepared.pages.map((p) => p.sourceIndex)).toEqual([0, 1]);
    expect(readdirSync(t.outDir)).toHaveLength(2);
    expect(t.win.destroyed).toBe(true);
  });

  it('at a hold inside a page, or on a page that arrives then, leaves that page unread, unchecked and unwritten', async () => {
    let held = false;
    const t = setup([0, 1, 2], () => ({ pdfHold: () => held }));
    const jobId = await jobOf(t);
    expect(await t.session.page(t.sender, checkpoint(jobId, 0, 3))).toBe(true);
    expect(await t.session.page(t.sender, page(jobId, 0))).toBe(true);
    held = true;
    expect(await t.session.page(t.sender, checkpoint(jobId, 1, 3))).toBe(false);
    const prepared = await t.result;
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared).toMatchObject({ total: 3, failed: [], unread: [1, 2] });
    expect(t.handed.map(({ index }) => index)).toEqual([0]);

    let late = false;
    const u = setup([0, 1], () => ({ pdfHold: () => late }));
    const second = await jobOf(u);
    expect(await u.session.page(u.sender, checkpoint(second, 0, 2))).toBe(true);
    late = true;
    expect(await u.session.page(u.sender, page(second, 0))).toBe(false);
    const ended = await u.result;
    if (!ended.ok) throw new Error(ended.message);
    expect(ended).toMatchObject({ pages: [], failed: [], unread: [0, 1] });
    expect(u.handed).toEqual([]);
    expect(readdirSync(u.outDir)).toEqual([]);
  });

  it('a later job of the same PDF counts the bytes its earlier jobs kept against the one budget', async () => {
    const budget = { assetBytes: EDITABLE_SOURCE_LIMITS.jobAssetBytes - 4, metadataBytes: 0 };
    const t = setup([0, 1], () => ({ pdfBudget: budget }));
    const jobId = await jobOf(t);
    expect(await t.session.page(t.sender, checkpoint(jobId, 0, 2))).toBe(true);
    // Its 8 picture bytes would pass this PDF's budget: the page stays its picture.
    expect(await t.session.page(t.sender, page(jobId, 0))).toBe('skipped');
    expect(await t.session.page(t.sender, shapes(jobId, 1))).toBe(true);
    t.session.done(t.sender, { mode: 'editable-source', jobId, total: 2, failed: [] });
    const prepared = await t.result;
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.pages.map((p) => p.sourceIndex)).toEqual([1]);
    expect(prepared.failed).toEqual([0]);
    expect(budget.assetBytes).toBe(EDITABLE_SOURCE_LIMITS.jobAssetBytes - 4);
    expect(budget.metadataBytes).toBeGreaterThan(0);
    expect(readdirSync(t.outDir)).toEqual([]);
  });
});
