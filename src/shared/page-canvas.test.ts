import { describe, expect, it } from 'vitest';
import { addSlideAfter, newSlide } from '../renderer/src/editor/ops';
import type { EditDoc, EditSlide } from './slide-edit';
import { editDocSchema } from './slide-edit';
import { renderEditedSlide } from './slide-design';

function fixture(): { doc: EditDoc; slide: EditSlide } {
  const slide: EditSlide = {
    id: 'placeholder-page',
    label: '',
    notes: '',
    background: '#ffffff',
    darken: null,
    enabled: true,
    transition: null,
    autoAdvanceMs: null,
    macroId: null,
    elements: [],
    cues: [],
  };
  return {
    slide,
    doc: {
      presentationId: 'placeholder-document',
      name: 'Placeholder pages',
      width: 1280,
      height: 720,
      transition: null,
      loop: false,
      groups: [{ id: 'placeholder-group', name: 'Placeholder', color: null, slides: [slide] }],
    },
  };
}

describe('a native page canvas independent of its original file', () => {
  it('retains a blank page size in a validated editor document without inventing an original hash', () => {
    const { doc, slide } = fixture();
    Object.assign(slide, { pageSize: { width: 481.25, height: 319.5 } });
    const parsed = editDocSchema.parse(doc).groups[0]?.slides[0];
    if (!parsed) throw new Error('The generated page disappeared.');
    const size: unknown = Reflect.get(parsed, 'pageSize');
    expect(size).toEqual({ width: 481.25, height: 319.5 });
    expect(parsed.documentPage).toBeUndefined();
  });

  it('draws a native blank page at its own fractional size and keeps the presentation size', () => {
    const { doc, slide } = fixture();
    Object.assign(slide, { pageSize: { width: 481.25, height: 319.5 } });
    expect(renderEditedSlide(doc, slide)).toMatchObject({ width: 481.25, height: 319.5 });
    expect({ width: doc.width, height: doc.height }).toEqual({ width: 1280, height: 720 });
  });

  it('gives a new blank slide after a PDF page the selected paper size', () => {
    const { doc, slide } = fixture();
    slide.documentPage = { sha256: 'a'.repeat(64), ext: 'pdf', page: 0, width: 480, height: 320 };
    const blank = newSlide(null);
    const next = addSlideAfter(doc, slide.id, blank);
    const added = next.groups.flatMap((group) => group.slides).find((page) => page.id === blank.id);
    if (!added) throw new Error('The generated blank page was not added.');
    expect(renderEditedSlide(next, added)).toMatchObject({ width: 480, height: 320 });
    expect(added.documentPage).toBeUndefined();
  });
});
