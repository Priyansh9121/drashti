import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow, WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceRead } from '../documents/source-reader';
import { EditablePdfSessions } from './editable-pdf-session';

/*
 * One PDF page whose words and shapes fail Main's checks (Session 57, W5's review LOW-3: an object far off the page,
 * past Main's ±1,000,000 px bound) stays its saved picture, as a page over the output budget does: the other pages
 * are still made editable. A reply that breaks the hidden window's protocol (another job, a page not asked for or
 * sent twice, a field the protocol doesn't have, a list longer than any page's) still stops the whole job, and so
 * does cancelling. Transport only: the hidden window is played by the test.
 */

class HiddenWindow extends EventEmitter {
  destroyed = false;
  webContents = Object.assign(new EventEmitter(), { id: 502, getOSProcessId: () => 2 ** 30 });
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

function setup(pages: number[], checkpoint: SourceRead['checkpoint'] = () => Promise.resolve(true)) {
  const root = mkdtempSync(join(tmpdir(), 'drashti-editable-pdf-isolation-'));
  roots.push(root);
  const file = join(root, 'Placeholder isolation.pdf');
  writeFileSync(file, '%PDF-1.4 Placeholder transport fixture');
  const outDir = join(root, 'generated');
  const stop = new AbortController();
  const win = new HiddenWindow();
  const session = new EditablePdfSessions(() => win as unknown as BrowserWindow);
  const sender = { id: win.webContents.id } as WebContents;
  const result = session.readNow({
    ext: 'pdf',
    file,
    outDir,
    sourcePages: pages,
    signal: stop.signal,
    checkpoint,
  });
  return { outDir, stop, win, session, sender, result };
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
/** A page whose drawing lies far off the page: past Main's bound for the hidden window's reply. */
const offPage = (jobId: string, sourceIndex: number) => ({
  ...page(jobId, sourceIndex),
  elements: [{ ...picture, frame: { ...picture.frame, x: 2_000_000 } }],
});

describe('one PDF page that fails Main’s checks (Session 57)', () => {
  it('stays its saved picture; the pages before and after it are still prepared', async () => {
    const t = setup([0, 1, 2]);
    const jobId = await jobOf(t);
    expect(
      await t.session.page(t.sender, { mode: 'editable-checkpoint', jobId, sourceIndex: 0, total: 3 }),
    ).toBe(true);
    expect(await t.session.page(t.sender, page(jobId, 0))).toBe(true);
    expect(await t.session.page(t.sender, offPage(jobId, 1))).toBe(true);
    expect(await t.session.page(t.sender, page(jobId, 2))).toBe(true);
    t.session.done(t.sender, { mode: 'editable-source', jobId, total: 3, failed: [] });
    const prepared = await t.result;
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.pages.map((p) => p.sourceIndex)).toEqual([0, 2]);
    expect(prepared.failed).toEqual([1]);
    expect(prepared.total).toBe(3);
    // Nothing of the failing page was written: one picture each for pages 0 and 2.
    expect(readdirSync(t.outDir)).toHaveLength(2);
    expect(t.win.destroyed).toBe(true);
  });

  it('stays its saved picture when its words or pictures fail the checks in other ways too', async () => {
    const t = setup([0, 1, 2, 3, 4]);
    const jobId = await jobOf(t);
    const bad = [
      // A picture that is not a PNG.
      { ...page(jobId, 0), assets: [{ token: 'pdf-paint-1', png: new Uint8Array([1, 2, 3]) }] },
      // A page bigger than Edit slides takes.
      { ...page(jobId, 1), width: 20_000 },
      // A picture with no size.
      {
        ...page(jobId, 2),
        elements: [{ ...picture, frame: { ...picture.frame, width: 0 } }],
      },
      // A picture with no element that shows it.
      { ...page(jobId, 3), elements: [] },
    ];
    for (const reply of bad) expect(await t.session.page(t.sender, reply)).toBe(true);
    expect(await t.session.page(t.sender, page(jobId, 4))).toBe(true);
    t.session.done(t.sender, { mode: 'editable-source', jobId, total: 5, failed: [] });
    const prepared = await t.result;
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.pages.map((p) => p.sourceIndex)).toEqual([4]);
    expect(prepared.failed).toEqual([0, 1, 2, 3]);
    expect(readdirSync(t.outDir)).toHaveLength(1);
  });

  it.each([
    ['for another job', (jobId: string) => page(`${jobId} other`, 1)],
    ['for a page not asked for', (jobId: string) => page(jobId, 7)],
    [
      'with a field the protocol does not have',
      (jobId: string) => ({ ...page(jobId, 1), file: '/Placeholder.png' }),
    ],
    ['whose words are not a list', (jobId: string) => ({ ...page(jobId, 1), elements: 'Placeholder words' })],
    [
      'whose picture bytes are not bytes',
      (jobId: string) => ({ ...page(jobId, 1), assets: [{ token: 'pdf-paint-1', png: 'Placeholder' }] }),
    ],
    ['of another kind', (jobId: string) => ({ ...page(jobId, 1), mode: 'placeholder' })],
    // Longer than any page's lists (the page reader stops at 500 painted objects, each one element and at most one
    // picture, and says at most five things): refused before anything in them is read.
    [
      'with more words and shapes than a page may have',
      (jobId: string) => ({
        ...page(jobId, 1),
        elements: Array.from({ length: 501 }, (_, n) => ({ ...picture, id: `Placeholder ${String(n)}` })),
      }),
    ],
    [
      'with more pictures than a page may have',
      (jobId: string) => ({
        ...page(jobId, 1),
        assets: Array.from({ length: 501 }, () => page(jobId, 1).assets[0]),
      }),
    ],
    [
      'with more notes than a page may have',
      (jobId: string) => ({
        ...page(jobId, 1),
        issues: Array.from({ length: 101 }, () => 'Placeholder note'),
      }),
    ],
  ])('a reply %s still stops the whole job', async (_what, reply) => {
    const t = setup([0, 1]);
    const jobId = await jobOf(t);
    expect(await t.session.page(t.sender, page(jobId, 0))).toBe(true);
    expect(await t.session.page(t.sender, reply(jobId))).toBe(false);
    expect((await t.result).ok).toBe(false);
    expect(t.win.destroyed).toBe(true);
  });

  it('a page sent twice still stops the whole job, even when it failed the checks the first time', async () => {
    const t = setup([0, 1]);
    const jobId = await jobOf(t);
    expect(await t.session.page(t.sender, offPage(jobId, 0))).toBe(true);
    expect(await t.session.page(t.sender, page(jobId, 0))).toBe(false);
    expect((await t.result).ok).toBe(false);
    expect(readdirSync(t.outDir)).toEqual([]);
  });

  it('cancelling while a failing page is checked still stops the job, with nothing written', async () => {
    let blocked = false;
    const t = setup([0, 1], () => (blocked ? new Promise<boolean>(() => undefined) : Promise.resolve(true)));
    const jobId = await jobOf(t);
    blocked = true;
    const acknowledgement = t.session.page(t.sender, offPage(jobId, 0));
    t.stop.abort();
    expect(await acknowledgement).toBe(false);
    expect((await t.result).ok).toBe(false);
    expect(t.win.destroyed).toBe(true);
    expect(readdirSync(t.outDir)).toEqual([]);
  });
});
