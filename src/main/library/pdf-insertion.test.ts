import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import type { EditSlidesResult, InsertPdfPagesResult, SaveSlidesResult } from '../../shared/slide-edit';
import { DEFAULT_THEME } from '../../shared/themes';
import { PresentationRepo } from '../db/presentations';
import { SettingsRepo } from '../db/settings';
import type { SourceReader } from '../documents/source-reader';
import { sourceWrite } from '../documents/source-write';
import { makeTestPdf } from '../import/testing/make-pdf';
import { nativeSourceReader } from '../import/testing/native-source-reader';
import { bytesHash, originalWorld } from '../import/testing/original-fixture';
import { Revisions } from './revisions';
import { registerSlidesIpc } from './slides-ipc';
import { themeLook } from './themes';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('../ipc/handle', () => ({
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    handlers.set(channel, fn);
  },
}));
beforeEach(() => handlers.clear());
const event = { sender: { id: 101, isDestroyed: () => false } } as never;
const words = 'Placeholder inserted native words';
const call = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
  const handler = handlers.get(channel);
  if (!handler) throw new Error('The real PDF insertion handler was not registered.');
  return (await handler(...args)) as T;
};

async function fixture(reader: SourceReader = nativeSourceReader) {
  const w = originalWorld();
  try {
    const target = await w.importPdf();
    const file = join(w.externalDir, 'Placeholder insertion source.pdf');
    const bytes = makeTestPdf([
      {
        width: 480,
        height: 320,
        color: [30, 80, 120],
        text: words,
        syntheticImage: { x: 360, y: 30, width: 60, height: 40 },
      },
    ]);
    writeFileSync(file, bytes);
    const source = await w.importPdf({ paths: [file] });
    const presentations = new PresentationRepo(w.db);
    const beforeTarget = presentations.content(target.id),
      beforeSource = presentations.content(source.id);
    const access = { operator: true, pro: true };
    const revisions = new Revisions(),
      keep = vi.spyOn(revisions, 'keep');
    const changed: string[][] = [];
    const reads = vi.fn(reader);
    const controller = registerSlidesIpc({
      db: w.db,
      presentations,
      revisions,
      settings: new SettingsRepo(w.db),
      fromOperator: () => access.operator,
      mayPrepareSource: () => access.pro,
      sourceReader: reads,
      sourceWrite: sourceWrite(w.db),
      lookFor: (_theme, size) => themeLook({ ...DEFAULT_THEME }, size.width, size.height),
      changed: (ids) => {
        changed.push(ids);
      },
    });
    const opened = await call<EditSlidesResult>(IPC.library.slidesForEdit, event, target.id);
    if (!opened.ok) throw new Error(opened.message);
    reads.mockClear();
    return {
      w,
      target,
      source,
      file,
      bytes,
      presentations,
      beforeTarget,
      beforeSource,
      access,
      revisions,
      keep,
      changed,
      reads,
      controller,
      opened,
      close: async () => {
        controller.cancelSourcePreparation();
        await controller.drainSourcePreparation();
        w.clean();
      },
    };
  } catch (error) {
    w.clean();
    throw error;
  }
}

describe('the real retained PDF insertion coordinator', () => {
  it('prepares native source objects, authorizes fresh occurrences and saves as one revision without changing either original', async () => {
    const s = await fixture();
    try {
      const inserted = await call<InsertPdfPagesResult>(
        IPC.library.insertPdfPages,
        event,
        s.target.id,
        s.opened.stamp,
        s.source.id,
      );
      expect(inserted.ok).toBe(true);
      if (!inserted.ok) throw new Error(inserted.message);
      expect(inserted.pages).toHaveLength(1);
      const page = inserted.pages[0];
      if (!page) throw new Error('The generated inserted PDF page is missing.');
      expect(page.documentPage).toMatchObject({
        sha256: bytesHash(s.bytes),
        ext: 'pdf',
        page: 0,
        width: 480,
        height: 320,
      });
      expect(page.pageSize).toEqual({ width: 480, height: 320 });
      expect(page.elements.some((element) => element.kind === 'text' && element.text.includes(words))).toBe(
        true,
      );
      expect(page.elements.some((element) => element.kind === 'image')).toBe(true);
      expect(s.presentations.content(s.target.id)).toEqual(s.beforeTarget);
      expect(s.presentations.content(s.source.id)).toEqual(s.beforeSource);
      expect(s.keep).not.toHaveBeenCalled();
      expect(s.changed).toEqual([]);
      s.opened.doc.groups[0]?.slides.push(page);
      expect(s.controller.documentForExport(s.target.id, s.opened.doc, s.opened.stamp).ok).toBe(true);
      const saved = await call<SaveSlidesResult>(
        IPC.library.saveSlides,
        event,
        s.target.id,
        s.opened.doc,
        s.opened.stamp,
        false,
      );
      expect(saved.ok).toBe(true);
      if (!saved.ok) throw new Error(saved.message);
      expect(s.presentations.content(s.target.id)?.slides).toHaveLength(2);
      expect(s.presentations.content(s.source.id)).toEqual(s.beforeSource);
      expect(s.keep).toHaveBeenCalledOnce();
      expect(s.changed).toEqual([[s.target.id]]);
      expect(s.revisions.take(saved.revisionId)).toEqual([s.beforeTarget]);
      expect(readFileSync(s.w.source)).toEqual(s.w.bytes);
      expect(readFileSync(s.file)).toEqual(s.bytes);
      expect(readFileSync(s.w.owned)).toEqual(s.w.bytes);
    } finally {
      await s.close();
    }
  });

  it('refuses an unprivileged sender and a stale target before source work or revision writes', async () => {
    const s = await fixture();
    try {
      s.access.pro = false;
      expect(await call(IPC.library.pdfPageSources, event)).toEqual([]);
      expect(
        await call(IPC.library.insertPdfPages, event, s.target.id, s.opened.stamp, s.source.id),
      ).toMatchObject({ ok: false });
      s.access.pro = true;
      s.access.operator = false;
      expect(
        await call(IPC.library.insertPdfPages, event, s.target.id, s.opened.stamp, s.source.id),
      ).toMatchObject({ ok: false });
      s.access.operator = true;
      expect(
        await call(IPC.library.insertPdfPages, event, s.target.id, 'stale-placeholder-stamp', s.source.id),
      ).toMatchObject({ ok: false });
      expect(s.reads).not.toHaveBeenCalled();
      expect(s.keep).not.toHaveBeenCalled();
      expect(s.changed).toEqual([]);
      expect(s.presentations.content(s.target.id)).toEqual(s.beforeTarget);
    } finally {
      await s.close();
    }
  });

  it('binds cancellation to the requesting sender and discards a cancelled native preparation', async () => {
    let block = false;
    let release: () => void = () => undefined,
      started: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const s = await fixture(async (request) => {
      if (block) {
        started();
        await gate;
      }
      return nativeSourceReader(request);
    });
    try {
      block = true;
      const pending = call<InsertPdfPagesResult>(
        IPC.library.insertPdfPages,
        event,
        s.target.id,
        s.opened.stamp,
        s.source.id,
      );
      await entered;
      const other = { sender: { id: 202 } };
      expect(await call(IPC.library.cancelPdfInsertion, other, s.target.id, s.opened.stamp)).toBe(false);
      expect(await call(IPC.library.cancelPdfInsertion, event, s.target.id, s.opened.stamp)).toBe(true);
      release();
      expect(await pending).toMatchObject({ ok: false, cancelled: true });
      await s.controller.drainSourcePreparation();
      expect(s.keep).not.toHaveBeenCalled();
      expect(s.changed).toEqual([]);
      expect(s.presentations.content(s.target.id)).toEqual(s.beforeTarget);
      expect(s.presentations.content(s.source.id)).toEqual(s.beforeSource);
    } finally {
      release();
      await s.close();
    }
  });

  it('refuses a source changed while native reading was waiting', async () => {
    let block = false;
    let release: () => void = () => undefined,
      started: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const s = await fixture(async (request) => {
      if (block) {
        started();
        await gate;
      }
      return nativeSourceReader(request);
    });
    try {
      block = true;
      const pending = call<InsertPdfPagesResult>(
        IPC.library.insertPdfPages,
        event,
        s.target.id,
        s.opened.stamp,
        s.source.id,
      );
      await entered;
      s.w.db.prepare('UPDATE presentations SET content_rev = content_rev + 1 WHERE id = ?').run(s.source.id);
      release();
      expect(await pending).toMatchObject({ ok: false });
      expect(s.keep).not.toHaveBeenCalled();
      expect(s.changed).toEqual([]);
      expect(s.presentations.content(s.target.id)).toEqual(s.beforeTarget);
    } finally {
      release();
      await s.close();
    }
  });
});
