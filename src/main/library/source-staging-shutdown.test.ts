import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import type { EditSlidesResult } from '../../shared/slide-edit';
import { DEFAULT_THEME } from '../../shared/themes';
import { PresentationRepo } from '../db/presentations';
import { SettingsRepo } from '../db/settings';
import { SourceQuitGate } from '../documents/source-quit-gate';
import { SourceReaderQueue } from '../documents/source-reader-queue';
import { sourceWrite } from '../documents/source-write';
import { MediaStore } from '../import/media-store';
import { nativeSourceReader } from '../import/testing/native-source-reader';
import { originalWorld, PLACEHOLDER_WORDS } from '../import/testing/original-fixture';
import { Revisions } from './revisions';
import { registerSlidesIpc } from './slides-ipc';
import { themeLook } from './themes';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('../ipc/handle', () => ({
  handle: (name: string, fn: (...args: unknown[]) => unknown) => { handlers.set(name, fn); },
}));

// The baseline fallback keeps this a behavioral ordering RED before the new
// controller method exists. Missing/untracked drain still fails the assertions.
function drainFullPreparation(controller: object): Promise<void> {
  const optional = controller as { drainSourcePreparation?: () => Promise<void> };
  return optional.drainSourcePreparation?.() ?? Promise.resolve();
}

describe('full Main source staging before library shutdown', () => {
  it('waits for real held asset staging after the reader queue is idle, without committing cancelled media or content', async () => {
    handlers.clear();
    const w = originalWorld();
    let release: () => void = () => undefined;
    let restore: () => void = () => undefined;
    let preparing: Promise<EditSlidesResult> | undefined;
    let quitting: Promise<unknown> | undefined;
    let queue: SourceReaderQueue | undefined;
    let cancel: () => void = () => undefined;
    try {
      const imported = await w.importPdf();
      const presentations = new PresentationRepo(w.db);
      const before = presentations.content(imported.id);
      const mediaBefore = w.db.prepare('SELECT COUNT(*) FROM media').pluck().get();
      const order: string[] = [];
      let closing = false;
      let readActualWords = false;
      queue = new SourceReaderQueue(async (request) => {
        const native = await nativeSourceReader(request);
        readActualWords = native.ok && native.pages.some((page) => page.elements.some((element) => element.kind === 'text' && element.text.includes(PLACEHOLDER_WORDS)));
        return native;
      });
      const published = vi.fn();
      const controller = registerSlidesIpc({
        db: w.db, presentations, revisions: new Revisions(), settings: new SettingsRepo(w.db),
        fromOperator: () => true, mayPrepareSource: () => !closing,
        sourceReader: queue.read, sourceWrite: sourceWrite(w.db),
        lookFor: (_theme, size) => themeLook({ ...DEFAULT_THEME }, size.width, size.height), changed: published,
      });
      cancel = () => controller.cancelSourcePreparation();
      let reached: () => void = () => undefined;
      const held = new Promise<void>((resolve) => { reached = resolve; });
      const realStore = new MediaStore(w.db, { dir: w.mediaDir });
      const realStage = realStore.stage.bind(realStore);
      const spy = vi.spyOn(MediaStore.prototype, 'stage').mockImplementationOnce(async (file) => {
        const staged = await realStage(file);
        expect(staged.ok, 'actual generated checker image staging is a setup precondition').toBe(true);
        await new Promise<void>((resolve) => {
          let released = false;
          release = () => {
            if (released) return;
            released = true;
            order.push('asset stage drained');
            resolve();
          };
          reached();
        });
        return staged;
      });
      restore = () => { spy.mockRestore(); };
      const open = handlers.get(IPC.library.slidesForEdit);
      if (!open) throw new Error('No real slidesForEdit handler.');
      preparing = Promise.resolve(open({}, imported.id) as EditSlidesResult | Promise<EditSlidesResult>);
      const reachedStage = await Promise.race([held.then(() => true), preparing.then(() => false)]);
      expect(reachedStage, 'the real generated PDF must reach actual image staging before testing shutdown').toBe(true);
      expect(readActualWords, 'the real retained PDF was extracted before staging, never seeded').toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      const readers = queue;
      const gate = new SourceQuitGate({
        cancel: () => { closing = true; controller.cancelSourcePreparation(); },
        stop: async () => {
          await Promise.all([readers.stop(), drainFullPreparation(controller)]);
          return true;
        },
      });
      quitting = gate.drain().then((result) => {
        if (result.confirmed) order.push('library closed');
        return result;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(order, 'an idle reader queue is insufficient while Main is still staging').not.toContain('library closed');
      release();
      expect((await preparing).ok).toBe(false);
      expect(await quitting).toEqual({ confirmed: true });
      expect(order).toEqual(['asset stage drained', 'library closed']);
      expect(presentations.content(imported.id)).toEqual(before);
      expect(w.db.prepare('SELECT COUNT(*) FROM media').pluck().get()).toBe(mediaBefore);
      expect(published).not.toHaveBeenCalled();
      expect(readFileSync(w.owned)).toEqual(w.bytes);
      expect(readFileSync(w.source)).toEqual(w.bytes);
    } finally {
      cancel();
      release();
      await preparing?.catch(() => undefined);
      await quitting?.catch(() => undefined);
      await queue?.stop();
      restore();
      w.clean();
    }
  });
});

