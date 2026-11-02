import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import type { EditSlidesResult } from '../../shared/slide-edit';
import { DEFAULT_THEME } from '../../shared/themes';
import { PresentationRepo } from '../db/presentations';
import { SettingsRepo } from '../db/settings';
import { sourceWrite } from '../documents/source-write';
import { MediaStore } from '../import/media-store';
import { nativeSourceReader } from '../import/testing/native-source-reader';
import { originalWorld } from '../import/testing/original-fixture';
import { Revisions } from './revisions';
import { registerSlidesIpc } from './slides-ipc';
import { themeLook } from './themes';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('../ipc/handle', () => ({
  handle: (name: string, fn: (...args: unknown[]) => unknown) => {
    handlers.set(name, fn);
  },
}));
beforeEach(() => handlers.clear());

async function opened(id: string): Promise<EditSlidesResult> {
  const fn = handlers.get(IPC.library.slidesForEdit);
  if (!fn) throw new Error('No real editor open handler.');
  return (await fn({}, id)) as EditSlidesResult;
}

describe('native source preparation authority', () => {
  it('keeps a saved-canvas read harmless when source preparation is not authorized', async () => {
    const w = originalWorld();
    try {
      const imported = await w.importPdf();
      const presentations = new PresentationRepo(w.db);
      const before = presentations.content(imported.id);
      const count = w.db.prepare('SELECT COUNT(*) FROM media').pluck().get();
      const reader = vi.fn(nativeSourceReader);
      registerSlidesIpc({
        db: w.db,
        presentations,
        revisions: new Revisions(),
        settings: new SettingsRepo(w.db),
        fromOperator: () => false,
        mayPrepareSource: () => false,
        sourceReader: reader,
        sourceWrite: sourceWrite(w.db),
        lookFor: (_theme, size) => themeLook({ ...DEFAULT_THEME }, size.width, size.height),
        changed: () => undefined,
      });
      const result = await opened(imported.id);
      expect(result.ok).toBe(true);
      expect(reader).not.toHaveBeenCalled();
      expect(w.db.prepare('SELECT COUNT(*) FROM media').pluck().get()).toBe(count);
      expect(presentations.content(imported.id)).toEqual(before);
      expect(readFileSync(w.owned)).toEqual(w.bytes);
    } finally {
      w.clean();
    }
  });

  it.each(['authority', 'stamp'] as const)(
    'rechecks %s after real asset staging before hidden-media commit or cache publication',
    async (change) => {
      const w = originalWorld();
      let restore: () => void = () => undefined;
      try {
        const imported = await w.importPdf();
        const presentations = new PresentationRepo(w.db);
        const before = presentations.content(imported.id);
        const count = w.db.prepare('SELECT COUNT(*) FROM media').pluck().get();
        let allowed = true;
        registerSlidesIpc({
          db: w.db,
          presentations,
          revisions: new Revisions(),
          settings: new SettingsRepo(w.db),
          fromOperator: () => true,
          mayPrepareSource: () => allowed,
          sourceReader: nativeSourceReader,
          sourceWrite: sourceWrite(w.db),
          lookFor: (_theme, size) => themeLook({ ...DEFAULT_THEME }, size.width, size.height),
          changed: () => {
            throw new Error('Preparation cannot publish presentation writes.');
          },
        });
        const realStore = new MediaStore(w.db, { dir: w.mediaDir });
        const stage = realStore.stage.bind(realStore);
        const spy = vi.spyOn(MediaStore.prototype, 'stage').mockImplementationOnce(async (file) => {
          const real = await stage(file);
          if (change === 'authority') allowed = false;
          else
            w.db
              .prepare('UPDATE presentations SET content_rev = content_rev + 1 WHERE id = ?')
              .run(imported.id);
          return real;
        });
        restore = () => {
          spy.mockRestore();
        };
        const result = await opened(imported.id);
        expect(
          spy,
          'the real native PDF paint was actually staged before the guard changed',
        ).toHaveBeenCalled();
        expect(result.ok).toBe(false);
        expect(w.db.prepare('SELECT COUNT(*) FROM media').pluck().get()).toBe(count);
        expect(presentations.content(imported.id)).toEqual(before);
        expect(readFileSync(w.owned)).toEqual(w.bytes);
      } finally {
        restore();
        w.clean();
      }
    },
  );
});
