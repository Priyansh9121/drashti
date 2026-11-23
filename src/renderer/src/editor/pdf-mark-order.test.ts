import { beforeEach, describe, expect, it } from 'vitest';
import { stepCount } from '../../../shared/deck';
import { orderedPdfMarks } from '../../../shared/pdf-mark-motion';
import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import { renderEditedSlide } from '../../../shared/slide-design';
import { commit, redo, undo, useEditor } from './editor-store';
import { findSlide, newSlide } from './ops';
import { setPdfMarkClick } from './pdf-mark-order';
import { pdfMark } from './pdf-marks';

function fixture(): EditDoc {
  const page: EditSlide = {
    ...newSlide(null),
    id: 'page',
    documentPage: { ext: 'pdf', sha256: 'a'.repeat(64), page: 0, width: 480, height: 320 },
    elements: ['a', 'b', 'c'].map((id) => {
      const mark = pdfMark(
        'highlight',
        [
          { x: 10, y: 20 },
          { x: 90, y: 60 },
        ],
        id,
      );
      if (!mark) throw new Error('Generated mark is missing.');
      return mark;
    }),
  };
  return {
    presentationId: 'generated-pdf',
    name: 'Placeholder',
    width: 1920,
    height: 1080,
    transition: null,
    loop: false,
    groups: [{ id: 'group', name: '', color: null, slides: [page] }],
  };
}
const pageOf = (doc: EditDoc) => {
  const page = findSlide(doc, 'page');
  if (!page) throw new Error('Generated page is missing.');
  return page;
};
const clicks = (doc: EditDoc) => orderedPdfMarks(pageOf(doc).elements).map(({ id }) => id);

describe('choosing PDF mark clicks in the editor', () => {
  beforeEach(() => {
    const doc = fixture();
    useEditor.setState({
      doc,
      opened: doc,
      slideId: 'page',
      past: [],
      future: [],
      coalesce: null,
      gesture: null,
      selection: ['a'],
      editing: null,
      sourceConversion: null,
    });
  });

  it('keeps each opt-in, opt-out and its native conversion in one Undo step', () => {
    const before = fixture();
    const first = setPdfMarkClick(before, 'page', ['b'], true);
    commit(first);
    const saved = useEditor.getState().doc;
    if (!saved) throw new Error('No editor document.');
    expect(clicks(saved)).toEqual(['b']);
    expect(pageOf(saved).documentPage).toEqual({ ...pageOf(before).documentPage, edited: true });
    expect(useEditor.getState().past).toHaveLength(1);
    undo();
    expect(useEditor.getState().doc).toEqual(before);
    redo();
    expect(useEditor.getState().doc).toEqual(saved);
    commit(setPdfMarkClick(saved, 'page', ['a', 'c'], true));
    const next = useEditor.getState().doc;
    if (!next) throw new Error('No editor document.');
    expect(clicks(next)).toEqual(['b', 'a', 'c']);
    expect(stepCount(renderEditedSlide(next, pageOf(next)).deck)).toBe(4);
    commit(setPdfMarkClick(next, 'page', ['b'], false));
    const removed = useEditor.getState().doc;
    if (!removed) throw new Error('No editor document.');
    expect(clicks(removed)).toEqual(['a', 'c']);
    expect(pageOf(removed).elements.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
    undo();
    expect(useEditor.getState().doc).toEqual(next);
  });

  it('does nothing for missing objects, repeated choices, native slides or the master', () => {
    const before = fixture();
    expect(setPdfMarkClick(before, 'page', ['missing'], true)).toBe(before);
    expect(setPdfMarkClick(before, 'page', ['a'], false)).toBe(before);
    const first = setPdfMarkClick(before, 'page', ['a'], true);
    expect(setPdfMarkClick(first, 'page', ['a'], true)).toBe(first);
    const native = fixture();
    delete pageOf(native).documentPage;
    expect(setPdfMarkClick(native, 'page', ['a'], true)).toBe(native);
    const master = { ...before, master: pageOf(before) };
    expect(setPdfMarkClick(master, 'page', ['a'], true)).toBe(master);
  });

  it('opts older plain shapes into clicks and preserves a hidden mark’s choice while editing another', () => {
    const before = fixture();
    const page = pageOf(before);
    for (const element of page.elements) {
      if (element.kind === 'shape') delete element.pdfMark;
    }
    const legacy = setPdfMarkClick(before, 'page', ['a'], true);
    expect(clicks(legacy)).toEqual(['a']);
    expect(pageOf(legacy).elements[0]).toMatchObject({ pdfMark: { clickOrder: 1 } });
    const hidden = pageOf(legacy).elements[0];
    if (!hidden) throw new Error('Generated legacy mark is missing.');
    hidden.hidden = true;
    const next = setPdfMarkClick(legacy, 'page', ['b'], true);
    expect(clicks(next)).toEqual(['b']);
    expect(pageOf(next).elements[0]).toMatchObject({ hidden: true, pdfMark: { clickOrder: 1 } });
    expect(stepCount(renderEditedSlide(next, pageOf(next)).deck)).toBe(2);
  });
});
