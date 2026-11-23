import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { editDocOf } from './slides';
import { keepPdfPages } from './pdf-page-copies';

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Generated fixture is missing.');
  return value;
}
describe('PDF extracted presentation storage', () => {
  it('makes fresh stored identities, keeps page references and master, and leaves the original unchanged', () => {
    const db = openDatabase(':memory:');
    try {
      const repo = new PresentationRepo(db);
      const id = repo.insert({
        libraryId: repo.ensureLibrary('Placeholder'),
        name: 'Placeholder pages',
        groups: [
          {
            name: '',
            slides: [0, 1, 2].map((page) => ({
              elements: [],
              documentPage: { sha256: 'a'.repeat(64), ext: 'pdf', page, width: 400, height: 300 },
            })),
          },
        ],
      });
      const before = required(repo.content(id));
      const doc = editDocOf(before, 'Placeholder pages').doc;
      const copy = keepPdfPages(db, repo, doc, [0, 2]);
      const stored = required(repo.content(copy.id));
      expect(
        stored.slides.map((s) => (JSON.parse(required(s.document_page)) as { page: number }).page),
      ).toEqual([0, 2]);
      expect(stored.slides.every((s) => !before.slides.some((old) => old.id === s.id))).toBe(true);
      expect(repo.content(id)).toEqual(before);
      expect(repo.remove([copy.id])).toEqual([copy.id]);
      expect(repo.content(copy.id)).toBeNull();
      expect(repo.restore([copy.id])).toEqual([copy.id]);
      expect(repo.content(copy.id)).toEqual(stored);
      const added = doc.groups[0]?.slides[1];
      if (!added) throw new Error('Generated native page missing.');
      delete added.documentPage;
      const nativeCopy = keepPdfPages(db, repo, doc, [1]);
      expect(repo.content(nativeCopy.id)?.slides[0]?.document_page).toBeNull();
      const count = repo.list().length;
      expect(() => keepPdfPages(db, repo, doc, [3])).toThrow();
      expect(repo.list()).toHaveLength(count);
    } finally {
      db.close();
    }
  });
});
