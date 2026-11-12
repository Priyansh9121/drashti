import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow, WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfJob } from '../../shared/editable-source';
import { IPC } from '../../shared/ipc';
import type {
  EditSlide,
  EditSlidesResult,
  EditSourceUpdate,
  InsertPdfPagesResult,
} from '../../shared/slide-edit';
import { DEFAULT_THEME } from '../../shared/themes';
import { PresentationRepo } from '../db/presentations';
import { SettingsRepo } from '../db/settings';
import { sourceReader, unavailableSourceReader } from '../documents/source-reader';
import { SourceReaderQueue } from '../documents/source-reader-queue';
import { sourceWrite } from '../documents/source-write';
import { makeTestPdf } from '../import/testing/make-pdf';
import { originalWorld } from '../import/testing/original-fixture';
import { PdfPictures } from '../pictures/pdf-pictures';
import { Revisions } from './revisions';
import { registerSlidesIpc, type SlidesIpcDeps } from './slides-ipc';
import { themeLook } from './themes';

/*
 * Edit slides on a big PDF reads the rest of its pages behind the open editor, and that reading waits while the show
 * needs the computer (Session 57, C2 part 1; the lead's review HIGH-1 and the part 3 review's LOW-1). Here the whole of
 * Main's side is real: the editor's request, ImportedSlides, the source reader's queue (its 180 s), PdfPictures' one
 * queue shared with imports' pictures, and the hidden window's session (its own clock). Only the hidden window is
 * played by the test, page by page as editable-main.ts does, and the show is a flag the test sets.
 */

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('../ipc/handle', () => ({
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    handlers.set(channel, fn);
  },
}));
beforeEach(() => handlers.clear());

type World = ReturnType<typeof originalWorld>;
type Opened = Extract<EditSlidesResult, { ok: true }>;

const PAGES = 6;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const STOPPED_TO_INSERT =
  'Reading the rest of this PDF stopped to insert pages: its other pages stay as their saved pictures for now. Save, then open Edit slides again to edit their words and shapes.';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
/** Real turns of the event loop (the test's timers may be fake), for up to `ms` of real time, or until `done`. */
async function until(done: () => boolean, ms = 10_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) return false;
    await tick();
  }
  return true;
}

class HiddenWindow extends EventEmitter {
  destroyed = false;
  readonly webContents: EventEmitter & { id: number; getOSProcessId(): number };
  constructor(id: number) {
    super();
    this.webContents = Object.assign(new EventEmitter(), { id, getOSProcessId: () => 2 ** 30 });
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }
}

/** A page's words and shapes as the hidden window sends them: one shape, so nothing for Main to write. */
const shapePage = (jobId: string, sourceIndex: number) => ({
  mode: 'editable-source',
  jobId,
  sourceIndex,
  width: 960,
  height: 540,
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
  issues: [],
});

const editable = (slide: EditSlide) => slide.elements.some((element) => element.kind === 'shape');

/** The import's pictures of a PDF of `count` pages (each the generated picture), as C2's own test makes them. */
const pagesOf = (w: World, count: number) => async (file: string, dir: string) => {
  const drawn = await w.drawPdf(file, dir);
  const picture = drawn.pages[0];
  if (!picture) throw new Error('Missing generated PDF picture.');
  return {
    ...drawn,
    total: count,
    pages: Array.from({ length: count }, (_, index) => ({ ...picture, index })),
  };
};

/** The show: anything up, or the stream on, is `busy`; Main's own wait for it to be idle, as index.ts has it. */
function theShow() {
  let busy = false;
  const listeners = new Set<() => void>();
  return {
    busy: () => busy,
    set(next: boolean) {
      busy = next;
      for (const listener of [...listeners]) listener();
    },
    waitForIdle: (signal: AbortSignal) => {
      if (signal.aborted || !busy) return Promise.resolve(!signal.aborted);
      return new Promise<boolean>((resolve) => {
        const finish = (allowed: boolean) => {
          listeners.delete(check);
          signal.removeEventListener('abort', stop);
          resolve(allowed);
        };
        const check = () => {
          if (!busy) finish(true);
        };
        const stop = () => finish(false);
        listeners.add(check);
        signal.addEventListener('abort', stop, { once: true });
      });
    },
  };
}

async function setup() {
  const w = originalWorld();
  const { id } = await w.importPdf({ drawPdf: pagesOf(w, PAGES) });
  const presentations = new PresentationRepo(w.db);
  const slides = presentations.content(id)?.slides ?? [];
  if (slides.length !== PAGES) throw new Error('The generated PDF did not import as six pages.');
  const show = theShow();
  const windows: HiddenWindow[] = [];
  /** Where the hidden window waits before a page (by its index), until the test lets it go on. */
  const gates = new Map<number, { wait: Promise<void>; open: () => void }>();
  const gate = (index: number) => {
    let open: () => void = () => undefined;
    const wait = new Promise<void>((resolve) => {
      open = resolve;
    });
    gates.set(index, { wait, open });
    return open;
  };
  const pictures = new PdfPictures({
    open: () => {
      const win = new HiddenWindow(700 + windows.length);
      windows.push(win);
      // A window Main has closed may still be answering; whatever it says then is nothing to the test.
      void play(win).catch(() => undefined);
      return win as unknown as BrowserWindow;
    },
    size: () => ({ width: 960, height: 540 }),
    assetDirs: () => [],
    log: () => undefined,
  });
  async function play(win: HiddenWindow) {
    const sender = { id: win.webContents.id } as WebContents;
    let job: PdfJob | null = null;
    await until(() => {
      job = win.destroyed ? null : pictures.job(sender);
      return win.destroyed || job !== null;
    });
    const asked = job as PdfJob | null;
    if (!asked) return;
    if (!('mode' in asked)) {
      // An import's pictures: two pages, then done.
      for (const index of [0, 1]) await pictures.page(sender, { index, png: PNG, notes: '' });
      pictures.done(sender, { total: 2, failed: [] });
      return;
    }
    for (const sourceIndex of asked.sourcePages) {
      await gates.get(sourceIndex)?.wait;
      if (win.destroyed) return;
      const goOn = await pictures.page(sender, {
        mode: 'editable-checkpoint',
        jobId: asked.jobId,
        sourceIndex,
        total: PAGES,
      });
      if (!goOn) break;
      if (!(await pictures.page(sender, shapePage(asked.jobId, sourceIndex)))) break;
    }
    pictures.done(sender, { mode: 'editable-source', jobId: asked.jobId, total: PAGES, failed: [] });
  }
  const queue = new SourceReaderQueue(
    sourceReader((request) => pictures.readEditable(request), unavailableSourceReader),
  );
  const deps: SlidesIpcDeps = {
    db: w.db,
    presentations,
    revisions: new Revisions(),
    settings: new SettingsRepo(w.db),
    fromOperator: () => true,
    mayPrepareSource: () => true,
    sourceReader: queue.read,
    sourceWrite: sourceWrite(w.db),
    waitForPdfIdle: show.waitForIdle,
    showBusy: show.busy,
    lookFor: (_theme, size) => themeLook({ ...DEFAULT_THEME }, size.width, size.height),
    changed: () => undefined,
  };
  const controller = registerSlidesIpc(deps);
  const updates: EditSourceUpdate[] = [];
  const editor = {
    sender: {
      id: 900,
      send: (_channel: string, update: EditSourceUpdate) => updates.push(update),
      isDestroyed: () => false,
    },
  };
  const open = (slideId: string | null): Promise<Opened> => {
    const handler = handlers.get(IPC.library.slidesForEdit);
    if (!handler) throw new Error('The editor-open handler was not registered.');
    return Promise.resolve(
      handler(editor, id, { requestId: randomUUID(), slideId }) as
        EditSlidesResult | Promise<EditSlidesResult>,
    ).then((result) => {
      if (!result.ok) throw new Error(result.message);
      return result;
    });
  };
  /** The editor's last word from the reading: the issues it ends with. */
  const last = () => updates.find((update) => 'issues' in update);
  /** The slides the reading made editable after the editor opened. */
  const madeReady = () =>
    new Set(
      updates.flatMap((update) => ('pages' in update ? update.pages.filter(editable).map((p) => p.id) : [])),
    );
  const ids = slides.map((slide) => slide.id);
  return { w, id, ids, show, windows, gate, gates, pictures, controller, updates, open, last, madeReady };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function cleanUp(t: Setup | undefined) {
  if (!t) return;
  t.show.set(false);
  for (const { open } of t.gates.values()) open();
  await until(() => t.last() !== undefined, 5_000);
  t.controller.cancelSourcePreparation();
  await t.controller.drainSourcePreparation();
  t.w.clean();
}

describe('Edit slides reads the rest of a big PDF behind the editor (Session 57, C2 part 1)', () => {
  it('a show busy for longer than every reader’s clock still leaves every page editable after Clear all', async () => {
    let t: Setup | undefined;
    try {
      t = await setup();
      const go = t.gate(3);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      const opened = await t.open(t.ids[0] ?? null);
      const shown = opened.doc.groups.flatMap((group) => group.slides);
      // The requested page and its two neighbours are read at once; the rest are still to come.
      expect(shown.map(editable)).toEqual([true, true, true, false, false, false]);
      expect(opened.preparingSource).toEqual(t.ids.slice(3));
      // Something goes up as the reading goes on, and stays up past the reader's 180 s and the window's own time.
      t.show.set(true);
      go();
      await until(() => false, 200);
      await vi.advanceTimersByTimeAsync(200_000);
      await until(() => false, 200);
      expect(t.last(), 'nothing is given up while the show is busy').toBeUndefined();
      // Clear all: the rest is read, and every page becomes editable.
      t.show.set(false);
      expect(await until(() => t?.last() !== undefined)).toBe(true);
      expect([...t.madeReady()].sort()).toEqual(t.ids.slice(3).sort());
      expect(t.last()).toEqual(expect.objectContaining({ issues: [] }));
    } finally {
      vi.useRealTimers();
      await cleanUp(t);
    }
  });

  it('an import’s pictures still come through while the reading waits for the show', async () => {
    let t: Setup | undefined;
    try {
      t = await setup();
      const go = t.gate(3);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      await t.open(t.ids[0] ?? null);
      t.show.set(true);
      go();
      await until(() => false, 200);
      // PdfPictures draws an import's pages one document at a time, in the same queue as this reading.
      const drawn = t.pictures.draw(t.w.source, join(t.w.root, 'Placeholder import pictures'));
      let came: Awaited<typeof drawn> | null = null;
      void drawn.then((result) => {
        came = result;
      });
      await until(() => came !== null, 2_000);
      expect(came, 'the import’s pictures are drawn while the show is still busy').toMatchObject({
        ok: true,
        total: 2,
      });
      t.show.set(false);
      expect(await until(() => t?.last() !== undefined)).toBe(true);
      expect([...t.madeReady()].sort()).toEqual(t.ids.slice(3).sort());
      await drawn;
    } finally {
      vi.useRealTimers();
      await cleanUp(t);
    }
  });

  it('closing the editor while the reading waits for the show reads nothing more', async () => {
    let t: Setup | undefined;
    try {
      t = await setup();
      const go = t.gate(3);
      await t.open(t.ids[0] ?? null);
      t.show.set(true);
      go();
      await until(() => false, 200);
      const windows = t.windows.length;
      t.controller.cancelSourcePreparation();
      await until(() => t?.last() !== undefined);
      t.show.set(false);
      await until(() => false, 200);
      expect(t.windows.length, 'no new reading starts').toBe(windows);
      expect(t.madeReady().size).toBe(0);
      expect(t.windows.every((win) => win.destroyed)).toBe(true);
    } finally {
      await cleanUp(t);
    }
  });

  it('Insert pages while the rest is read says what stopped and what to do', async () => {
    let t: Setup | undefined;
    try {
      t = await setup();
      const other = join(t.w.root, 'Placeholder other.pdf');
      writeFileSync(
        other,
        makeTestPdf([{ width: 960, height: 540, color: [20, 80, 40], text: 'Placeholder other words' }]),
      );
      const { id: sourceId } = await t.w.importPdf({ paths: [other], drawPdf: pagesOf(t.w, 2) });
      t.gate(3);
      const opened = await t.open(t.ids[0] ?? null);
      const insert = handlers.get(IPC.library.insertPdfPages);
      if (!insert) throw new Error('The insert handler was not registered.');
      const inserted = await (insert({ sender: { id: 900 } }, t.id, opened.stamp, sourceId) as
        InsertPdfPagesResult | Promise<InsertPdfPagesResult>);
      expect(inserted).toMatchObject({ ok: true });
      expect(await until(() => t?.last() !== undefined)).toBe(true);
      expect(t.last()).toEqual(expect.objectContaining({ issues: [STOPPED_TO_INSERT] }));
    } finally {
      await cleanUp(t);
    }
  });
});
