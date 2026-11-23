import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { PresentationRepo, DbSlideSource, elementFromRow } from '../db/presentations';
import { editDocOf, applySlideEdit } from './slides';
import { editDocSchema } from '../../shared/slide-edit';
import {
  checkTranslation,
  draftTranslation,
  checkedText,
  editTranslation,
} from '../../shared/prepared-translations';
import type { TextElement } from '../../shared/model';
const source = 'The blue box is empty.';
const reviewed = () =>
  checkTranslation(draftTranslation(source, 'en', 'gu', 'Placeholder Q7'), source, 'Reader Q');
const box = (): TextElement => ({
  id: 'box',
  kind: 'text',
  text: source,
  lang: 'en',
  frame: { x: 10, y: 10, width: 600, height: 120 },
  style: {
    fontFamily: null,
    fontSize: 48,
    fontWeight: 400,
    color: '#ffffff',
    align: 'left',
    verticalAlign: 'top',
    lineHeight: 1.45,
    shadow: false,
  },
  translations: [reviewed()],
});
describe('saved prepared translations', () => {
  it('keeps valid original words when optional saved translation metadata is malformed, while still refusing invalid originals', () => {
    const db = openDatabase(':memory:');
    try {
      const repo = new PresentationRepo(db);
      const id = repo.insert({
        libraryId: repo.ensureLibrary('Default'),
        name: 'Placeholder',
        groups: [{ name: 'One', slides: [{ elements: [box()] }] }],
      });
      const row = required(required(repo.content(id)).elements[0]);
      const props = JSON.parse(row.props) as Record<string, unknown>;
      for (const invalid of [
        { translations: [{ ...reviewed(), text: 'Altered unchecked placeholder' }] },
        { translations: [reviewed(), reviewed()] },
        { translationDisplay: { choice: 'unknown' } },
      ]) {
        const output = elementFromRow({ ...row, props: JSON.stringify({ ...props, ...invalid }) });
        expect(output).toMatchObject({ kind: 'text', text: source, lang: 'en', style: box().style });
        if (output?.kind !== 'text') throw new Error('Original was lost');
        expect(output.translations).toBeUndefined();
        expect(output.translationDisplay).toBeUndefined();
      }
      expect(elementFromRow({ ...row, props: JSON.stringify({ ...props, text: 42 }) })).toBeNull();
    } finally {
      db.close();
    }
  });

  it('keeps review through SQLite, validated editor round trips and Undo, but holds changed source', () => {
    const db = openDatabase(':memory:');
    try {
      const repo = new PresentationRepo(db);
      const id = repo.insert({
        libraryId: repo.ensureLibrary('Default'),
        name: 'Placeholder',
        groups: [{ name: 'One', slides: [{ elements: [box()] }] }],
      });
      const before = required(repo.content(id));
      const doc = editDocSchema.parse(editDocOf(before, 'Placeholder').doc);
      const el = required(required(doc.groups[0]).slides[0]).elements[0] as TextElement;
      expect(el.translations).toEqual([reviewed()]);
      el.text = 'The green box is empty.';
      repo.setContent(applySlideEdit(before, doc));
      const changed = required(
        required(editDocOf(required(repo.content(id)), 'Placeholder').doc.groups[0]).slides[0],
      ).elements[0] as TextElement;
      expect(changed.translations?.[0]?.state).toBe('needs-recheck');
      expect(changed.translations?.[0]?.text).toBe('Placeholder Q7');
      expect(checkedText(required(required(changed.translations)[0]), changed.text)).toBeNull();
      repo.setContent(before);
      const undone = required(
        required(editDocOf(required(repo.content(id)), 'Placeholder').doc.groups[0]).slides[0],
      ).elements[0] as TextElement;
      expect(checkedText(required(required(undone.translations)[0]), source)).toBe('Placeholder Q7');
    } finally {
      db.close();
    }
  });
  it('clears the named review when translated words change, including a stale source', () => {
    expect(editTranslation(reviewed(), source, 'Placeholder R8')).toEqual({
      ...reviewed(),
      text: 'Placeholder R8',
      reviewFingerprint: null,
      reader: null,
      state: 'unchecked',
    });
    const updated = editTranslation(reviewed(), 'Changed source.', 'Placeholder R8');
    expect(updated.sourceFingerprint).toBe(JSON.stringify('Changed source.'));
    expect(updated.state).toBe('unchecked');
  });
  it('refuses duplicate targets and oversized translation metadata at the editor boundary', () => {
    const db = openDatabase(':memory:');
    try {
      const repo = new PresentationRepo(db);
      const id = repo.insert({
        libraryId: repo.ensureLibrary('Default'),
        name: 'Placeholder',
        groups: [{ name: 'One', slides: [{ elements: [box()] }] }],
      });
      const doc = editDocOf(required(repo.content(id)), 'Placeholder').doc;
      const el = required(required(doc.groups[0]).slides[0]).elements[0] as TextElement;
      el.translations = [reviewed(), reviewed()];
      expect(editDocSchema.safeParse(doc).success).toBe(false);
      el.translations = [{ ...reviewed(), text: 'x'.repeat(20001) }];
      expect(editDocSchema.safeParse(doc).success).toBe(false);
    } finally {
      db.close();
    }
  });
  it('sends only checked current pairs to the show, with no reader name or draft corpus', () => {
    const db = openDatabase(':memory:');
    try {
      const repo = new PresentationRepo(db);
      const el = box();
      el.translations = [reviewed(), draftTranslation(source, 'en', 'hi', 'Private draft placeholder')];
      const id = repo.insert({
        libraryId: repo.ensureLibrary('Default'),
        name: 'Placeholder',
        groups: [{ name: 'One', slides: [{ elements: [el] }] }],
      });
      const output = new DbSlideSource(repo).order(id)?.slides[0]?.slide.elements[0];
      if (output?.kind !== 'text') throw new Error('Missing source');
      expect(output.translations).toHaveLength(1);
      expect(output.translations?.[0]?.text).toBe('Placeholder Q7');
      expect(JSON.stringify(output)).not.toContain('Reader Q');
      expect(JSON.stringify(output)).not.toContain('Private draft placeholder');
      expect(
        editDocOf(required(repo.content(id)), 'Placeholder').doc.groups[0]?.slides[0]?.elements[0],
      ).toMatchObject({
        translations: [reviewed(), draftTranslation(source, 'en', 'hi', 'Private draft placeholder')],
      });
    } finally {
      db.close();
    }
  });
  it('holds review when a non-editor content write changes source words or language', () => {
    const db = openDatabase(':memory:');
    try {
      const repo = new PresentationRepo(db);
      const id = repo.insert({
        libraryId: repo.ensureLibrary('Default'),
        name: 'Placeholder',
        groups: [{ name: 'One', slides: [{ elements: [box()] }] }],
      });
      const before = required(repo.content(id));
      const row = required(before.elements[0]);
      const props = JSON.parse(row.props) as Record<string, unknown>;
      props['text'] = 'Changed green box.';
      repo.setContent({ ...before, elements: [{ ...row, props: JSON.stringify(props) }] });
      const changed = required(repo.content(id)).elements[0];
      expect(JSON.parse(required(changed).props)).toMatchObject({
        translations: [{ state: 'needs-recheck', reader: null }],
      });
      repo.setContent(before);
      props['text'] = source;
      props['lang'] = 'hi';
      repo.setContent({ ...before, elements: [{ ...row, props: JSON.stringify(props) }] });
      expect(JSON.parse(required(required(repo.content(id)).elements[0]).props)).toMatchObject({
        translations: [{ state: 'needs-recheck', reader: null }],
      });
    } finally {
      db.close();
    }
  });
});

function required<T>(value: T): NonNullable<T> {
  if (value == null) throw new Error('Missing test fixture value');
  return value;
}
