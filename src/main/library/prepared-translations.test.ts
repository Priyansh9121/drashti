import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { editDocOf, applySlideEdit } from './slides';
import { editDocSchema } from '../../shared/slide-edit';
import { checkTranslation, draftTranslation, checkedText, editTranslation } from '../../shared/prepared-translations';
import type { TextElement } from '../../shared/model';

const source = 'The blue box is empty.';
const reviewed = () => checkTranslation(draftTranslation(source, 'en', 'gu', 'Placeholder Q7'), source, 'Reader Q');
const box = (): TextElement => ({
  id: 'box', kind: 'text', text: source, lang: 'en',
  frame: { x: 10, y: 10, width: 600, height: 120 },
  style: { fontFamily: null, fontSize: 48, fontWeight: 400, color: '#ffffff', align: 'left', verticalAlign: 'top', lineHeight: 1.45, shadow: false },
  translations: [reviewed()],
});

describe('saved prepared translations', () => {
  it('keeps review through SQLite, validated editor round trips and Undo, but holds changed source', () => {
    const db = openDatabase(':memory:');
    try {
      const repo = new PresentationRepo(db);
      const id = repo.insert({ libraryId: repo.ensureLibrary('Default'), name: 'Placeholder', groups: [{ name: 'One', slides: [{ elements: [box()] }] }] });
      const before = repo.content(id)!;
      const doc = editDocSchema.parse(editDocOf(before, 'Placeholder').doc);
      const el = doc.groups[0]!.slides[0]!.elements[0] as TextElement;
      expect(el.translations).toEqual([reviewed()]);
      el.text = 'The green box is empty.';
      repo.setContent(applySlideEdit(before, doc));
      const changed = editDocOf(repo.content(id)!, 'Placeholder').doc.groups[0]!.slides[0]!.elements[0] as TextElement;
      expect(changed.translations?.[0]?.state).toBe('needs-recheck');
      expect(changed.translations?.[0]?.text).toBe('Placeholder Q7');
      expect(checkedText(changed.translations![0]!, changed.text)).toBeNull();
      repo.setContent(before);
      const undone = editDocOf(repo.content(id)!, 'Placeholder').doc.groups[0]!.slides[0]!.elements[0] as TextElement;
      expect(checkedText(undone.translations![0]!, source)).toBe('Placeholder Q7');
    } finally { db.close(); }
  });
  it('clears the named review when translated words change, including a stale source', () => {
    expect(editTranslation(reviewed(), source, 'Placeholder R8')).toEqual({ ...reviewed(), text: 'Placeholder R8', reader: null, state: 'unchecked' });
    const updated = editTranslation(reviewed(), 'Changed source.', 'Placeholder R8');
    expect(updated.sourceFingerprint).toBe(JSON.stringify('Changed source.'));
    expect(updated.state).toBe('unchecked');
  });
  it('refuses duplicate targets and oversized translation metadata at the editor boundary', () => {
    const db = openDatabase(':memory:');
    try {
      const repo = new PresentationRepo(db);
      const id = repo.insert({ libraryId: repo.ensureLibrary('Default'), name: 'Placeholder', groups: [{ name: 'One', slides: [{ elements: [box()] }] }] });
      const doc = editDocOf(repo.content(id)!, 'Placeholder').doc;
      const el = doc.groups[0]!.slides[0]!.elements[0] as TextElement;
      el.translations = [reviewed(), reviewed()];
      expect(editDocSchema.safeParse(doc).success).toBe(false);
      el.translations = [{ ...reviewed(), text: 'x'.repeat(20_001) }];
      expect(editDocSchema.safeParse(doc).success).toBe(false);
    } finally { db.close(); }
  });
});
