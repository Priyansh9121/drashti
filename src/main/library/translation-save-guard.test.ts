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
vi.mock('../ipc/handle', () => ({ handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn) }));
const call = <T>(channel: string, ...args: unknown[]) => handlers.get(channel)!(...args) as T;

describe('Main enforces prepared translation review bounds', () => {
  it('refuses Simple Mode approval over the real save channel, while allowing a source edit that holds the old translation', async () => {
    const db = openDatabase(':memory:');
    try {
      const presentations = new PresentationRepo(db);
      const source = 'The blue box is empty.';
      const el: TextElement = { id: 'e', kind: 'text', text: source, lang: 'en', frame: { x: 0, y: 0, width: 600, height: 100 }, style: DEFAULT_THEME.text.style, translations: [draftTranslation(source, 'en', 'gu', 'Placeholder Q7')] };
      const id = presentations.insert({ libraryId: presentations.ensureLibrary('Default'), name: 'Placeholder', groups: [{ name: 'One', slides: [{ elements: [el] }] }] });
      const mode = { pro: false };
      registerSlidesIpc({ db, presentations, settings: new SettingsRepo(db), revisions: new Revisions(), fromOperator: () => true, mayChangeTranslations: () => mode.pro, lookFor: (_theme, size) => themeLook(DEFAULT_THEME, size.width, size.height), changed: () => undefined });
      const opened = await call<Promise<EditSlidesResult> | EditSlidesResult>(IPC.library.slidesForEdit, {}, id);
      if (!opened.ok) throw new Error(opened.message);
      const edited = structuredClone(opened.doc);
      const box = edited.groups[0]!.slides[0]!.elements[0] as TextElement;
      box.translations = [checkTranslation(box.translations![0]!, source, 'Reader Q')];
      expect(call<SaveSlidesResult>(IPC.library.saveSlides, {}, id, edited, opened.stamp, false)).toMatchObject({ ok: false, message: expect.stringContaining('Pro Mode') });
      const sourceEdit = structuredClone(opened.doc);
      (sourceEdit.groups[0]!.slides[0]!.elements[0] as TextElement).text = 'Changed blue box.';
      expect(call<SaveSlidesResult>(IPC.library.saveSlides, {}, id, sourceEdit, opened.stamp, false).ok).toBe(true);
      const again = await call<Promise<EditSlidesResult> | EditSlidesResult>(IPC.library.slidesForEdit, {}, id);
      if (!again.ok) throw new Error(again.message);
      const held = again.doc.groups[0]!.slides[0]!.elements[0] as TextElement;
      expect(held.translations![0]!.state).toBe('needs-recheck');
      expect(held.translations![0]!.reader).toBeNull();
    } finally { db.close(); }
  });
});
