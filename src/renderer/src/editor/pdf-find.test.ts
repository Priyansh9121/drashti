import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditDoc } from '../../../shared/slide-edit';
import type { TextElement } from '../../../shared/model';
import { findMatches, pdfFindStatus, replaceMatches } from './find-replace';
import { newSlide } from './ops';
import { commit, undo, useEditor } from './editor-store';

const box = (id: string): TextElement => ({
  id,
  kind: 'text',
  text: 'Placeholder alpha alpha',
  lang: 'en',
  frame: { x: 20, y: 20, width: 180, height: 40 },
  style: {
    fontFamily: 'Noto Sans',
    fontSize: 12,
    fontWeight: 400,
    color: '#000000',
    align: 'left',
    verticalAlign: 'top',
    lineHeight: 1.2,
    shadow: false,
  },
});
const page = (id: string, page: number) => ({
  ...newSlide(null),
  id,
  elements: [box(id + '-words')],
  documentPage: { sha256: 'a'.repeat(64), ext: 'pdf' as const, page },
});
const doc: EditDoc = {
  presentationId: 'placeholder',
  name: 'Placeholder PDF',
  width: 480,
  height: 320,
  transition: null,
  loop: false,
  groups: [{ id: 'g', name: '', color: null, slides: [page('one', 0), page('two', 1)] }],
};
const options = { matchCase: false, wholeWords: true };
afterEach(() => vi.unstubAllGlobals());

describe('Find across editable PDF pages', () => {
  it('finds in page order and replaces one occurrence without changing the other pages', () => {
    const matches = findMatches(doc, 'alpha', options);
    expect(matches.map((match) => match.slideId)).toEqual(['one', 'one', 'two', 'two']);
    const first = matches[0];
    if (!first) throw new Error('Missing placeholder match');
    const next = replaceMatches(doc, [first], 'beta');
    expect(next.groups[0]?.slides[0]?.elements[0]).toMatchObject({ text: 'Placeholder beta alpha' });
    expect(next.groups[0]?.slides[1]?.elements).toBe(doc.groups[0]?.slides[1]?.elements);
  });
  it('replaces all pages in one Undo step, including their native conversion', () => {
    vi.stubGlobal('window', { drashti: {} });
    useEditor.setState({
      doc,
      opened: doc,
      past: [],
      future: [],
      preparingSource: new Set(),
      slideId: 'one',
      selection: [],
      sourceConversion: null,
    });
    commit(replaceMatches(doc, findMatches(doc, 'alpha', options), 'કખગઘઙ'));
    expect(useEditor.getState().past).toHaveLength(1);
    for (const slide of useEditor.getState().doc?.groups[0]?.slides ?? []) {
      expect(slide.documentPage?.edited).toBe(true);
      expect(slide.elements[0]).toMatchObject({ text: 'Placeholder કખગઘઙ કખગઘઙ' });
    }
    undo();
    expect(useEditor.getState().doc).toBe(doc);
    expect(useEditor.getState().past).toHaveLength(0);
  });
  it('says when PDF pages are still preparing and excludes them from matches', () => {
    const preparingPages = new Set(['two']);
    expect(pdfFindStatus(doc, preparingPages)).toBe(
      '1 PDF page is still preparing. Find searches its words when it is ready.',
    );
    expect(findMatches(doc, 'alpha', { ...options, preparingPages }).map((match) => match.slideId)).toEqual([
      'one',
      'one',
    ]);
    expect(pdfFindStatus(doc, new Set())).toBe('');
  });
});
