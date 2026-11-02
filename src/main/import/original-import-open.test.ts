import { existsSync, readFileSync, rmSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditSlidesResult } from '../../shared/slide-edit';
import { DEFAULT_THEME } from '../../shared/themes';
import { PresentationRepo } from '../db/presentations';
import { SettingsRepo } from '../db/settings';
import { Revisions } from '../library/revisions';
import { registerSlidesIpc } from '../library/slides-ipc';
import { themeLook } from '../library/themes';
import { bytesHash, originalWorld, PLACEHOLDER_WORDS } from './testing/original-fixture';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('../ipc/handle', () => ({
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    handlers.set(channel, fn);
  },
}));
beforeEach(() => handlers.clear());

/* The real open handler prepares the working document; merely opening must not change stored playback. */
describe('retained PDF originals', () => {
  it('keeps the imported PDF bytes under their hash, independently of the external source', async () => {
    const w = originalWorld();
    try {
      const imported = await w.importPdf();
      expect(imported.summary.totals).toMatchObject({
        imported: 1,
        failed: 0,
        presentations: 1,
        slides: 1,
      });
      expect(
        w.db.prepare('SELECT source_hash FROM presentations WHERE id = ?').pluck().get(imported.id),
      ).toBe(w.hash);
      expect(bytesHash(readFileSync(w.source))).toBe(w.hash);
      expect(existsSync(w.owned)).toBe(true);
      expect(bytesHash(readFileSync(w.owned))).toBe(w.hash);
      expect(readFileSync(w.owned)).toEqual(w.bytes);
      rmSync(w.source); // Only this fixture's generated external PDF.
      expect(readFileSync(w.owned)).toEqual(w.bytes);
    } finally {
      w.clean();
    }
  });

  it('prepares native words on the first editor open after the generated external PDF was deleted, without changing playback', async () => {
    const w = originalWorld();
    try {
      const imported = await w.importPdf();
      expect(imported.summary.totals).toMatchObject({
        imported: 1,
        failed: 0,
        presentations: 1,
        slides: 1,
      });
      const presentations = new PresentationRepo(w.db);
      const playbackBefore = presentations.content(imported.id);
      expect(playbackBefore?.slides).toHaveLength(1);
      rmSync(w.source);
      expect(existsSync(w.source)).toBe(false);
      registerSlidesIpc({
        db: w.db,
        presentations,
        revisions: new Revisions(),
        settings: new SettingsRepo(w.db),
        fromOperator: () => true,
        lookFor: (_theme, size) => themeLook({ ...DEFAULT_THEME }, size.width, size.height),
        changed: () => {
          throw new Error('Opening must not publish a saved content change.');
        },
      });
      const open = handlers.get('library:slides-for-edit');
      if (!open) throw new Error('The existing editor-open handler was not registered.');
      // This awaits either the current synchronous result or real asynchronous preparation later.
      const opened = (await open({} as never, imported.id)) as EditSlidesResult;
      expect(opened.ok).toBe(true);
      if (!opened.ok) throw new Error(opened.message);
      expect(presentations.content(imported.id)).toEqual(playbackBefore);
      const boxes = opened.doc.groups
        .flatMap((g) => g.slides)
        .flatMap((s) => s.elements)
        .filter((e) => e.kind === 'text');
      // The PNG stand-in supplies no words. Native text must come from the retained PDF's real preparation path.
      expect(boxes.map((box) => box.text).join('\n')).toContain(PLACEHOLDER_WORDS);
      expect(boxes.every((box) => !box.runs || box.runs.map((run) => run.text).join('') === box.text)).toBe(
        true,
      );
      expect(presentations.content(imported.id)).toEqual(playbackBefore);
    } finally {
      w.clean();
    }
  });
});
