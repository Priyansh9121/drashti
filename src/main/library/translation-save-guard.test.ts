import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { checkTranslation, draftTranslation } from '../../shared/prepared-translations';
import type { EditSlidesResult, SaveSlidesResult } from '../../shared/slide-edit';
import type { TextElement } from '../../shared/model';
import { DEFAULT_THEME } from '../../shared/themes';
import { openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { SettingsRepo } from '../db/settings';
import { Revisions } from './revisions';
import { registerSlidesIpc } from './slides-ipc';
import { themeLook } from './themes';
const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('../ipc/handle', () => ({
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
}));
const call = (channel: string, ...args: unknown[]): unknown => required(handlers.get(channel))(...args);
describe('Main enforces prepared translation review bounds', () => {
  it('refuses Simple Mode approval over the real save channel, while allowing a source edit that holds the old translation', async () => {
    const db = openDatabase(':memory:');
    try {
      const presentations = new PresentationRepo(db);
      const source = 'The blue box is empty.';
      const el: TextElement = {
        id: 'e',
        kind: 'text',
        text: source,
        lang: 'en',
        frame: { x: 0, y: 0, width: 600, height: 100 },
        style: themeLook(DEFAULT_THEME, 1920, 1080).style,
        translations: [draftTranslation(source, 'en', 'gu', 'Placeholder Q7')],
      };
      const id = presentations.insert({
        libraryId: presentations.ensureLibrary('Default'),
        name: 'Placeholder',
        groups: [{ name: 'One', slides: [{ elements: [el] }] }],
      });
      const mode = { pro: false };
      registerSlidesIpc({
        db,
        presentations,
        settings: new SettingsRepo(db),
        revisions: new Revisions(),
        fromOperator: () => true,
        mayChangeTranslations: () => mode.pro,
        lookFor: (_theme, size) => themeLook(DEFAULT_THEME, size.width, size.height),
        changed: () => undefined,
      });
      const opened = await (call(IPC.library.slidesForEdit, {}, id) as
        Promise<EditSlidesResult> | EditSlidesResult);
      if (!opened.ok) throw new Error(opened.message);
      const edited = structuredClone(opened.doc);
      const box = required(required(edited.groups[0]).slides[0]).elements[0] as TextElement;
      box.translations = [checkTranslation(required(required(box.translations)[0]), source, 'Reader Q')];
      const refused = call(IPC.library.saveSlides, {}, id, edited, opened.stamp, false) as SaveSlidesResult;
      expect(refused.ok).toBe(false);
      if (refused.ok) throw new Error('Simple Mode approval succeeded');
      expect(refused.message).toContain('Pro Mode');
      const sourceEdit = structuredClone(opened.doc);
      (required(required(sourceEdit.groups[0]).slides[0]).elements[0] as TextElement).text =
        'Changed blue box.';
      expect(
        (call(IPC.library.saveSlides, {}, id, sourceEdit, opened.stamp, false) as SaveSlidesResult).ok,
      ).toBe(true);
      const again = await (call(IPC.library.slidesForEdit, {}, id) as
        Promise<EditSlidesResult> | EditSlidesResult);
      if (!again.ok) throw new Error(again.message);
      const held = required(required(again.doc.groups[0]).slides[0]).elements[0] as TextElement;
      expect(required(required(held.translations)[0]).state).toBe('needs-recheck');
      expect(required(required(held.translations)[0]).reader).toBeNull();
    } finally {
      db.close();
    }
  });
});

function required<T>(value: T): NonNullable<T> {
  if (value == null) throw new Error('Missing test fixture value');
  return value;
}
