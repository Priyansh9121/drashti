import { describe, expect, it } from 'vitest';
import { editDocSchema } from '../../shared/slide-edit';
import { openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { textSlide } from '../engine/testing';
import { applySlideEdit, editDocOf, mediaIdsOf } from './slides';

function setup() {
  const db = openDatabase(':memory:');
  const repo = new PresentationRepo(db);
  const libraryId = repo.ensureLibrary('Placeholder design');
  const id = repo.insert({
    libraryId,
    name: 'Placeholder design',
    groups: [
      { name: 'Placeholder group', slides: [{ elements: textSlide('s', 'Placeholder words').elements }] },
    ],
  });
  const before = repo.content(id);
  if (!before) throw new Error('no placeholder presentation');
  const doc = editDocOf(before, 'Placeholder design').doc;
  return { db, repo, id, before, doc };
}

describe('Design and Motion saved from the slide editor', () => {
  it('leaves an older presentation byte-for-byte unchanged when it is opened and saved', () => {
    const t = setup();
    try {
      expect(applySlideEdit(t.before, editDocSchema.parse(t.doc))).toEqual(t.before);
    } finally {
      t.db.close();
    }
  });

  it('saves the chosen slide size, and Undo can put the original size back', () => {
    const t = setup();
    try {
      const next = applySlideEdit(t.before, { ...t.doc, width: 1440, height: 1080 });
      expect([next.width, next.height]).toEqual([1440, 1080]);
      t.repo.setContent(next);
      expect(t.repo.get(t.id)).toMatchObject({ width: 1440, height: 1080 });
      t.repo.setContent(t.before);
      expect(t.repo.content(t.id)).toEqual(t.before);
    } finally {
      t.db.close();
    }
  });

  it('rejects a master whose id is already used by a real slide', () => {
    const t = setup();
    try {
      const slide = t.doc.groups[0]?.slides[0];
      if (!slide) throw new Error('no slide');
      expect(editDocSchema.safeParse({ ...t.doc, master: { ...slide, elements: [] } }).success).toBe(false);
    } finally {
      t.db.close();
    }
  });

  it('keeps a gradient and the element’s in, emphasis and out timing through validation and storage', () => {
    const t = setup();
    try {
      const slide = t.doc.groups[0]?.slides[0];
      if (!slide) throw new Error('no slide');
      const design = {
        backdrop: { kind: 'gradient', from: '#123456', to: '#654321', angle: 90 },
        layout: 'two-columns',
      };
      const motion = {
        in: { kind: 'fade', delayMs: 0, durationMs: 1000 },
        emphasis: { kind: 'pulse', delayMs: 1500, durationMs: 700 },
        out: { kind: 'fade', delayMs: 4000, durationMs: 600 },
      };
      const raw = {
        ...t.doc,
        groups: [
          {
            ...t.doc.groups[0],
            slides: [{ ...slide, design, elements: slide.elements.map((el) => ({ ...el, motion })) }],
          },
        ],
      };
      const validated = editDocSchema.parse(raw);
      expect(validated).toMatchObject(raw);
      t.repo.setContent(applySlideEdit(t.before, validated));
      expect(editDocOf(t.repo.content(t.id) ?? t.before, t.doc.name).doc).toMatchObject(raw);
      expect(t.repo.get(t.id)?.groups[0]?.slides[0]?.slide).toMatchObject({
        backdrop: design.backdrop,
        elements: [expect.objectContaining({ motion })],
      });
    } finally {
      t.db.close();
    }
  });

  it('keeps one editable master and resolves it behind slides, including its media dependencies', () => {
    const t = setup();
    try {
      const slide = t.doc.groups[0]?.slides[0];
      if (!slide) throw new Error('no slide');
      const master = {
        ...slide,
        id: 'placeholder-master',
        label: 'Master',
        elements: textSlide('master-text', 'Placeholder shared heading').elements.map((el) => ({
          ...el,
          id: 'placeholder-master-text',
        })),
        design: { backdrop: { kind: 'picture', mediaId: 'placeholder-master-picture', fit: 'fill' } },
      };
      const raw = {
        ...t.doc,
        master,
        groups: [{ ...t.doc.groups[0], slides: [{ ...slide, background: null }] }],
      };
      const validated = editDocSchema.parse(raw);
      expect(validated).toMatchObject(raw);
      expect(mediaIdsOf(validated)).toContain('placeholder-master-picture');
      t.repo.setContent(applySlideEdit(t.before, validated));
      const read = editDocOf(t.repo.content(t.id) ?? t.before, 'Placeholder design').doc;
      expect(read).toMatchObject({ master: { label: 'Master' } });
      const shown = t.repo.get(t.id)?.groups[0]?.slides[0]?.slide;
      expect(shown).toMatchObject({ backdrop: master.design.backdrop });
      expect(shown?.elements).toHaveLength(slide.elements.length + master.elements.length);
      expect(shown?.elements[0]).toMatchObject({ text: 'Placeholder shared heading' });
    } finally {
      t.db.close();
    }
  });

  it('keeps a slide’s existing picture cue in front of the master’s background', () => {
    const t = setup();
    try {
      t.db.prepare('INSERT INTO media (id, kind, name, path) VALUES (?, ?, ?, ?)').run('placeholder-own-picture', 'image', 'Placeholder own picture', 'placeholder.png');
      const slide = t.doc.groups[0]?.slides[0];
      if (!slide) throw new Error('no slide');
      const master = { ...slide, id: 'placeholder-master', background: '#445566', elements: [], cues: [] };
      const doc = { ...t.doc, master, groups: [{ ...t.doc.groups[0], slides: [{ ...slide, background: null, cues: [{ id: 'placeholder-background-cue', kind: 'background' as const, label: '', mediaId: 'placeholder-own-picture', props: '{"media":"image","fit":"fill"}' }] }] }] };
      t.repo.setContent(applySlideEdit(t.before, editDocSchema.parse(doc)));
      const read = t.repo.get(t.id)?.groups[0]?.slides[0];
      expect(read?.cues).toHaveLength(1);
      expect(read?.slide.background).toBeNull();
    } finally { t.db.close(); }
  });
});
