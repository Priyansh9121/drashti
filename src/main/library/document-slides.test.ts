import { describe, expect, it } from 'vitest';
import type { DeckSlide } from '../../shared/deck';
import type { EditDoc, EditSlide } from '../../shared/slide-edit';
import { editDocSchema } from '../../shared/slide-edit';
import { renderEditedSlide } from '../../shared/slide-design';
import type { ContentRows, SlideRow } from '../db/content';
import { applySlideEdit, editDocOf } from './slides';

const source = { sha256: 'a'.repeat(64), ext: 'pptx', page: 1 };
const deck: DeckSlide = {
  steps: [{ clipId: 'placeholder-clip', clipMs: 1000, lastId: 'placeholder-frame' }],
  media: [],
};

function fixture(): ContentRows {
  const slides = [0, 1, 2].map((page): SlideRow & { document_page: string } => ({
    id: `placeholder-slide-${page}`,
    group_id: 'placeholder-group',
    position: page,
    label: `Placeholder ${page}`,
    notes: '',
    background: null,
    darken: null,
    transition: null,
    auto_advance_ms: null,
    enabled: 1,
    macro_id: null,
    deck: JSON.stringify({ ...deck, preservedUnknown: `Placeholder ${page}` }),
    document_page: JSON.stringify({ ...source, page }),
  }));
  return {
    presentationId: 'placeholder-presentation',
    width: 1280,
    height: 720,
    selectedArrangementId: null,
    themeId: null,
    transition: null,
    loop: 0,
    groups: [{ id: 'placeholder-group', name: 'Placeholder', color: null, position: 0 }],
    slides,
    elements: [],
    cues: [],
    arrangements: [],
    arrangementEntries: [],
    kirtan: null,
    autoLines: [],
  };
}

const pageData = (slide: EditSlide) => slide.documentPage;
const storedPage = (slide: SlideRow | undefined) => slide?.document_page;

function groupOf(doc: EditDoc) {
  const group = doc.groups[0];
  if (!group) throw new Error('The generated document has no group.');
  return group;
}
function middleOf(doc: EditDoc): EditSlide {
  const middle = groupOf(doc).slides[1];
  if (!middle) throw new Error('The generated document has no middle page.');
  return middle;
}

describe('document page identity through the existing slide editor', () => {
  it('previews a prepared page on its own canvas while keeping the presentation size unchanged', () => {
    const doc = editDocOf(fixture(), 'Placeholder').doc;
    const slide = middleOf(doc);
    Object.assign(slide, { documentPage: { ...source, ext: 'pdf', width: 480, height: 320 } });
    expect(renderEditedSlide(doc, slide)).toMatchObject({ width: 480, height: 320 });
    expect({ width: doc.width, height: doc.height }).toEqual({ width: 1280, height: 720 });
  });
  it('opens each stored page identity without changing its source index or saved playback', () => {
    const before = fixture();
    const { doc } = editDocOf(before, 'Placeholder');
    expect(pageData(middleOf(doc))).toEqual(source);
    expect(applySlideEdit(before, doc).slides).toEqual(before.slides);
  });

  it('validates and retains a page identity and its independent page geometry in an IPC save', () => {
    const doc = editDocOf(fixture(), 'Placeholder').doc;
    Object.assign(middleOf(doc), {
      documentPage: { ...source, edited: true, width: 480, height: 320, rotation: 90 },
    });
    const checked = editDocSchema.parse(doc);
    expect(pageData(middleOf(checked))).toEqual({
      ...source,
      edited: true,
      width: 480,
      height: 320,
      rotation: 90,
    });
  });

  it('converts only the explicitly acknowledged page and preserves the other exact deck rows', () => {
    const before = fixture();
    const doc = editDocOf(before, 'Placeholder').doc;
    Object.assign(middleOf(doc), { documentPage: { ...source, edited: true } });
    delete middleOf(doc).deck;
    const after = applySlideEdit(before, doc);
    expect(after.slides[1]?.deck).toBeNull();
    expect(JSON.parse(storedPage(after.slides[1]) ?? 'null')).toEqual({ ...source, edited: true });
    expect(after.slides[0]).toEqual(before.slides[0]);
    expect(after.slides[2]).toEqual(before.slides[2]);
  });

  it('does not infer conversion from an omitted deck or from notes, hide and reordering', () => {
    const before = fixture();
    const doc: EditDoc = editDocOf(before, 'Placeholder').doc;
    const middle = middleOf(doc);
    delete middle.deck;
    middle.notes = 'Placeholder notes only';
    middle.enabled = false;
    groupOf(doc).slides.reverse();
    const after = applySlideEdit(before, doc);
    expect(after.slides.find((slide) => slide.id === middle.id)?.deck).toBe(before.slides[1]?.deck);
    expect(storedPage(after.slides.find((slide) => slide.id === middle.id))).toBe(
      storedPage(before.slides[1]),
    );
  });
});
