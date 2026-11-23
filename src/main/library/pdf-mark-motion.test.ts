import { describe, expect, it } from 'vitest';
import { stepCount } from '../../shared/deck';
import { deckSlideAt } from '../../shared/deck-show';
import type { ShapeElement } from '../../shared/model';
import { pdfMarkTarget } from '../../shared/pdf-mark-motion';
import { editDocSchema } from '../../shared/slide-edit';
import { openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { applySlideEdit, editDocOf } from './slides';

const mark = (id: string, clickOrder?: number): ShapeElement => ({
  id,
  kind: 'shape',
  shape: 'rectangle',
  frame: { x: 10, y: 20, width: 80, height: 40 },
  fill: '#f4c542',
  cornerRadius: 0,
  opacity: 0.32,
  pdfMark: { tool: 'highlight', ...(clickOrder === undefined ? {} : { clickOrder }) },
});

describe('saved PDF mark clicks', () => {
  it('survives editor save and Main-owned new IDs, sharing each step with phone and stage stills', () => {
    const db = openDatabase(':memory:');
    try {
      const repo = new PresentationRepo(db);
      const id = repo.insert({
        libraryId: repo.ensureLibrary('Placeholder'),
        name: 'Placeholder PDF',
        groups: [
          {
            name: '',
            slides: [
              {
                documentPage: {
                  ext: 'pdf',
                  sha256: 'a'.repeat(64),
                  page: 0,
                  edited: true,
                  width: 480,
                  height: 320,
                },
                elements: [mark('page')],
              },
            ],
          },
        ],
      });
      const before = repo.content(id);
      if (!before) throw new Error('Generated presentation is missing.');
      const doc = editDocOf(before, 'Placeholder PDF').doc;
      const page = doc.groups[0]?.slides[0];
      if (!page) throw new Error('Generated page is missing.');
      page.elements.push(mark('editor-new-mark', 1), mark('editor-second-mark', 2));
      repo.setContent(applySlideEdit(before, editDocSchema.parse(doc)));
      const saved = repo.content(id);
      if (!saved) throw new Error('Saved presentation is missing.');
      const slide = repo.get(id)?.groups[0]?.slides[0]?.slide;
      if (!slide) throw new Error('Saved slide is missing.');
      const first = slide.elements[1],
        second = slide.elements[2];
      if (!first || !second) throw new Error('Saved marks are missing.');
      expect(first.id).not.toBe('editor-new-mark');
      expect(second.id).not.toBe('editor-second-mark');
      expect(stepCount(slide.deck)).toBe(3);
      expect(slide.deck?.motion?.effects.map(({ shapeId }) => shapeId)).toEqual([
        pdfMarkTarget(first.id),
        pdfMarkTarget(second.id),
      ]);
      expect(deckSlideAt(slide, 0).elements).toHaveLength(1);
      expect(deckSlideAt(slide, 1).elements.map(({ id }) => id)).toEqual([slide.elements[0]?.id, first.id]);
      expect(deckSlideAt(slide, 2).elements).toEqual(slide.elements);
      expect(saved.slides[0]?.deck ?? null).toBeNull();
      const reopened = editDocOf(saved, 'Placeholder PDF').doc;
      expect(reopened.groups[0]?.slides[0]?.elements).toEqual(slide.elements);
      expect(applySlideEdit(saved, editDocSchema.parse(reopened))).toEqual(saved);
    } finally {
      db.close();
    }
  });
});
