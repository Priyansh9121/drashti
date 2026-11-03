import { randomUUID } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import type {
  EditSlidesResult,
  InsertPdfPagesResult,
  SaveSlidesResult,
  LinkPdfPageResult,
} from '../../shared/slide-edit';
import { DEFAULT_THEME } from '../../shared/themes';
import { PresentationRepo } from '../db/presentations';
import { SettingsRepo } from '../db/settings';
import type { SourceReader } from '../documents/source-reader';
import { sourceWrite } from '../documents/source-write';
import { makeTestPdf } from '../import/testing/make-pdf';
import { OriginalsStore } from '../import/originals-store';
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

async function fixture(
  reader: SourceReader = nativeSourceReader,
  choosePdfFile?: () => Promise<string | null>,
) {
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
      choosePdfFile,
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
  it('inserts a directly chosen PDF without another presentation and keeps its retained original and source protection', async () => {
    let chosen = '';
    const s = await fixture(nativeSourceReader, () => Promise.resolve(chosen));
    try {
      chosen = join(s.w.externalDir, 'Placeholder direct only.pdf');
      const bytes = makeTestPdf([
        { width: 319.25, height: 481.5, color: [50, 80, 100], text: 'Placeholder direct native words' },
      ]);
      writeFileSync(chosen, bytes);
      const countBefore = s.w.db.prepare('SELECT COUNT(*) FROM presentations').pluck().get();
      const inserted = await call<InsertPdfPagesResult>(
        IPC.library.insertPdfFile,
        event,
        s.target.id,
        s.opened.stamp,
      );
      expect(inserted.ok).toBe(true);
      if (!inserted.ok) throw new Error(inserted.message);
      const page = inserted.pages[0];
      if (!page) throw new Error('The directly selected PDF page was not prepared.');
      expect(page.pageSize).toEqual({ width: 319.25, height: 481.5 });
      expect(
        page.elements.some(
          (element) => element.kind === 'text' && element.text.includes('Placeholder direct native words'),
        ),
      ).toBe(true);
      const originals = new OriginalsStore(s.w.db, s.w.mediaDir);
      expect(originals.sourceLocations()).toContain(chosen);
      const original = originals.list().find((entry) => entry.sha256 === bytesHash(bytes));
      if (!original) throw new Error('The directly selected original was not retained.');
      const kept = await originals.resolve(original);
      if (!kept) throw new Error('The directly selected retained bytes were not readable.');
      expect(readFileSync(kept)).toEqual(bytes);
      expect(s.w.db.prepare('SELECT COUNT(*) FROM presentations').pluck().get()).toBe(countBefore);
      expect(s.presentations.content(s.target.id)).toEqual(s.beforeTarget);
      expect(s.keep).not.toHaveBeenCalled();
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
      expect(s.keep).toHaveBeenCalledOnce();
      expect(s.presentations.content(s.target.id)?.slides).toHaveLength(2);
      expect(s.w.db.prepare('SELECT COUNT(*) FROM presentations').pluck().get()).toBe(countBefore);
      expect(readFileSync(chosen)).toEqual(bytes);
    } finally {
      await s.close();
    }
  });

  it('never opens a file chooser for denied or stale requests and ignores a late choice after cancellation', async () => {
    let complete: (file: string | null) => void = () => undefined;
    const chosen = new Promise<string | null>((resolve) => {
      complete = resolve;
    });
    const picker = vi.fn(() => chosen);
    const s = await fixture(nativeSourceReader, picker);
    try {
      const originals = new OriginalsStore(s.w.db, s.w.mediaDir);
      const before = originals.list(),
        locations = originals.sourceLocations();
      s.access.pro = false;
      expect(await call(IPC.library.insertPdfFile, event, s.target.id, s.opened.stamp)).toMatchObject({
        ok: false,
      });
      s.access.pro = true;
      expect(
        await call(IPC.library.insertPdfFile, event, s.target.id, 'stale-placeholder-stamp'),
      ).toMatchObject({ ok: false });
      expect(picker).not.toHaveBeenCalled();
      const pending = call<InsertPdfPagesResult>(
        IPC.library.insertPdfFile,
        event,
        s.target.id,
        s.opened.stamp,
      );
      await vi.waitFor(() => expect(picker).toHaveBeenCalledOnce());
      expect(await call(IPC.library.cancelPdfInsertion, event, s.target.id, s.opened.stamp)).toBe(true);
      complete(s.file);
      expect(await pending).toMatchObject({ ok: false, cancelled: true });
      expect(s.reads).not.toHaveBeenCalled();
      expect(originals.list()).toEqual(before);
      expect(originals.sourceLocations()).toEqual(locations);
      expect(s.presentations.content(s.target.id)).toEqual(s.beforeTarget);
      expect(s.keep).not.toHaveBeenCalled();
    } finally {
      complete(null);
      await s.close();
    }
  });

  it('does not register a non-PDF file or save pages when actual native reading fails', async () => {
    let chosen = '';
    const s = await fixture(nativeSourceReader, () => Promise.resolve(chosen));
    try {
      chosen = join(s.w.externalDir, 'Placeholder invalid.pdf');
      const bytes = Buffer.from('Placeholder invalid PDF bytes');
      writeFileSync(chosen, bytes);
      const originals = new OriginalsStore(s.w.db, s.w.mediaDir);
      const before = originals.list(),
        locations = originals.sourceLocations();
      expect(await call(IPC.library.insertPdfFile, event, s.target.id, s.opened.stamp)).toMatchObject({
        ok: false,
      });
      expect(originals.list()).toEqual(before);
      expect(originals.sourceLocations()).toEqual(locations);
      expect(s.presentations.content(s.target.id)).toEqual(s.beforeTarget);
      expect(s.keep).not.toHaveBeenCalled();
      expect(readFileSync(chosen)).toEqual(bytes);
    } finally {
      await s.close();
    }
  });

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

describe('explicit legacy PDF reading-copy mapping', () => {
  for (const legacy of ['ambiguous', 'ppt', 'key'] as const) {
    it(`links a selected PDF page for ${legacy}, preserving unsaved additions and Undo`, async () => {
      let picked = '';
      const s = await fixture(nativeSourceReader, () => Promise.resolve(picked));
      try {
        const row = s.beforeTarget?.slides[0];
        if (!row) throw new Error('Missing generated source picture.');
        let legacyFile: string | null = null;
        const legacyBytes = Buffer.from('Placeholder generated legacy bytes');
        let legacyRef: { sha256: string; ext: 'ppt' | 'key'; page: number } | null = null;
        if (legacy !== 'ambiguous') {
          const file = join(s.w.externalDir, `Placeholder retained legacy.${legacy}`);
          legacyFile = file;
          writeFileSync(file, legacyBytes);
          const originals = new OriginalsStore(s.w.db, s.w.mediaDir);
          const staged = await originals.stage(file, legacy);
          if (!staged.ok) throw new Error(staged.message);
          originals.register(staged.original, file);
          legacyRef = { sha256: staged.original.sha256, ext: legacy, page: 3 };
        }
        s.w.db
          .prepare('UPDATE slides SET document_page = ? WHERE id = ?')
          .run(legacyRef ? JSON.stringify(legacyRef) : null, row.id);
        s.w.db
          .prepare('UPDATE presentations SET content_rev = content_rev + 1 WHERE id = ?')
          .run(s.target.id);
        const opened = await call<EditSlidesResult>(IPC.library.slidesForEdit, event, s.target.id);
        if (!opened.ok) throw new Error(opened.message);
        const group = opened.doc.groups[0],
          target = group?.slides[0];
        const image = target?.elements.find((element) => element.kind === 'image');
        if (!group || !target || !image) throw new Error('Missing generated legacy picture.');
        image.groupId = 'placeholder-operator-group';
        target.notes = 'Placeholder operator notes';
        target.guides = { x: [100], y: [200] };
        target.cues = [
          { id: randomUUID(), kind: 'clear', label: 'Placeholder clear cue', mediaId: null, props: '{}' },
        ];
        const overlay = {
          id: randomUUID(),
          kind: 'text' as const,
          groupId: 'placeholder-operator-group',
          text: 'Placeholder unsaved overlay',
          lang: null,
          frame: { x: 80, y: 90, width: 300, height: 100 },
          style: opened.look.style,
        };
        target.elements.push(overlay);
        const undo = structuredClone(opened.doc),
          before = s.presentations.content(s.target.id);
        picked = join(s.w.externalDir, 'Placeholder explicit reading copy.pdf');
        const bytes = makeTestPdf([{ width: 480, height: 320, color: [20, 50, 80], text: words }]);
        writeFileSync(picked, bytes);
        const prepared = await call<InsertPdfPagesResult>(
          IPC.library.insertPdfFile,
          event,
          s.target.id,
          opened.stamp,
        );
        if (!prepared.ok || !prepared.pages[0]) throw new Error('Real PDF reading copy preparation failed.');
        const linked = await call<LinkPdfPageResult>(
          IPC.library.linkPdfPage,
          event,
          s.target.id,
          opened.doc,
          opened.stamp,
          target.id,
          image.id,
          prepared.pages[0].id,
        );
        expect(linked.ok).toBe(true);
        if (!linked.ok) throw new Error(linked.message);
        expect(linked.page.documentPage).toMatchObject({
          sha256: bytesHash(bytes),
          ext: 'pdf',
          page: 0,
          edited: true,
          width: opened.doc.width,
          height: opened.doc.height,
        });
        expect(linked.page.elements.find((element) => element.id === overlay.id)).toEqual(overlay);
        expect(linked.page.elements.some((element) => element.id === image.id)).toBe(false);
        expect(
          linked.page.elements
            .filter((element) => element.kind === 'text')
            .map((element) => element.text)
            .join(' '),
        ).toContain(words);
        expect(
          linked.page.elements
            .filter((element) => element.id !== overlay.id)
            .every((element) => element.groupId === image.groupId),
          'native source objects retain the saved picture’s operator group',
        ).toBe(true);
        expect(linked.page).toMatchObject({ notes: target.notes, guides: target.guides, cues: target.cues });
        expect(s.presentations.content(s.target.id)).toEqual(before);
        expect(s.keep).not.toHaveBeenCalled();
        expect(s.controller.documentForExport(s.target.id, undo, opened.stamp).ok).toBe(true);
        group.slides[0] = linked.page;
        const stripped = structuredClone(opened.doc),
          strippedPage = stripped.groups[0]?.slides[0];
        if (!strippedPage) throw new Error('Missing generated linked page.');
        delete strippedPage.documentPage;
        expect(s.controller.documentForExport(s.target.id, stripped, opened.stamp).ok).toBe(false);
        expect(
          await call<SaveSlidesResult>(
            IPC.library.saveSlides,
            event,
            s.target.id,
            opened.doc,
            opened.stamp,
            false,
          ),
        ).toMatchObject({ ok: true });
        expect(s.keep).toHaveBeenCalledTimes(1);
        const reopened = await call<EditSlidesResult>(IPC.library.slidesForEdit, event, s.target.id);
        if (!reopened.ok) throw new Error(reopened.message);
        const saved = reopened.doc.groups[0]?.slides[0];
        const savedOverlay = saved?.elements.find(
          (element) => element.kind === 'text' && element.text === overlay.text,
        );
        expect(savedOverlay).toEqual({ ...overlay, id: savedOverlay?.id });
        expect(savedOverlay?.id).not.toBe(overlay.id);
        expect(saved?.notes).toBe(target.notes);
        expect(saved?.cues.map(({ id: _id, ...cue }) => cue)).toEqual(
          target.cues.map(({ id: _id, ...cue }) => cue),
        );
        expect(saved?.cues[0]?.id).not.toBe(target.cues[0]?.id);
        if (legacyFile) expect(readFileSync(legacyFile)).toEqual(legacyBytes);
        expect(readFileSync(picked)).toEqual(bytes);
        expect(readFileSync(s.w.source)).toEqual(s.w.bytes);
        expect(readFileSync(s.w.owned)).toEqual(s.w.bytes);
      } finally {
        await s.close();
      }
    });
  }
  it('denies stale or non-Pro mapping and never guesses either page or picture', async () => {
    const s = await fixture();
    try {
      s.access.pro = false;
      expect(
        await call<LinkPdfPageResult>(
          IPC.library.linkPdfPage,
          event,
          s.target.id,
          s.opened.doc,
          s.opened.stamp,
          'placeholder-slide',
          'placeholder-picture',
          'placeholder-page',
        ),
      ).toMatchObject({ ok: false });
      s.access.pro = true;
      expect(
        await call<LinkPdfPageResult>(
          IPC.library.linkPdfPage,
          event,
          s.target.id,
          s.opened.doc,
          'placeholder-old-stamp',
          'placeholder-slide',
          'placeholder-picture',
          'placeholder-page',
        ),
      ).toMatchObject({ ok: false });
      expect(
        await call<LinkPdfPageResult>(
          IPC.library.linkPdfPage,
          event,
          s.target.id,
          s.opened.doc,
          s.opened.stamp,
          'placeholder-slide',
          'placeholder-picture',
          'placeholder-page',
        ),
      ).toMatchObject({ ok: false });
      expect(s.keep).not.toHaveBeenCalled();
      expect(s.presentations.content(s.target.id)).toEqual(s.beforeTarget);
    } finally {
      await s.close();
    }
  });
});
