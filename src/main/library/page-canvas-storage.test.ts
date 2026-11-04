import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { applySlideEdit, editDocOf } from './slides';

describe('independent native paper sizes in a library', () => {
  it('stores a new blank page size without inventing an imported file', () => {
    const db = openDatabase(':memory:');
    try {
      const repo = new PresentationRepo(db);
      const libraryId = repo.ensureLibrary('Placeholder');
      const page = { elements: [] };
      Object.assign(page, { pageSize: { width: 481.25, height: 319.5 } });
      const id = repo.insert({
        libraryId,
        name: 'Placeholder paper',
        groups: [{ name: '', slides: [page] }],
      });
      const stored = repo.content(id);
      if (!stored) throw new Error('The generated presentation was not stored.');
      const reopened = editDocOf(stored, 'Placeholder paper').doc.groups[0]?.slides[0];
      expect(reopened && Reflect.get(reopened, 'pageSize')).toEqual({ width: 481.25, height: 319.5 });
      expect(reopened?.documentPage).toBeUndefined();
      expect(repo.get(id)?.groups[0]?.slides[0]?.slide).toMatchObject({ width: 481.25, height: 319.5 });
    } finally {
      db.close();
    }
  });

  it('keeps exact paper geometry through content save and an earlier revision restore', () => {
    const db = openDatabase(':memory:');
    try {
      const repo = new PresentationRepo(db);
      const libraryId = repo.ensureLibrary('Placeholder');
      const id = repo.insert({
        libraryId,
        name: 'Placeholder paper',
        groups: [{ name: '', slides: [{ elements: [] }] }],
      });
      const before = repo.content(id);
      if (!before) throw new Error('The generated presentation was not stored.');
      const doc = editDocOf(before, 'Placeholder paper').doc;
      const page = doc.groups[0]?.slides[0];
      if (!page) throw new Error('The generated blank page disappeared.');
      Object.assign(page, { pageSize: { width: 320, height: 480 } });
      repo.setContent(applySlideEdit(before, doc));
      const saved = repo.content(id);
      if (!saved) throw new Error('The generated presentation disappeared.');
      const reopened = editDocOf(saved, 'Placeholder paper').doc.groups[0]?.slides[0];
      expect(reopened && Reflect.get(reopened, 'pageSize')).toEqual({ width: 320, height: 480 });
      expect(repo.get(id)?.groups[0]?.slides[0]?.slide).toMatchObject({ width: 320, height: 480 });
      repo.setContent(before);
      expect(repo.get(id)?.groups[0]?.slides[0]?.slide).toMatchObject({
        width: before.width,
        height: before.height,
      });
      expect(
        editDocOf(repo.content(id) ?? before, '').doc.groups[0]?.slides[0]?.documentPage,
      ).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
