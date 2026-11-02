import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditDoc, EditSlidesResult } from '../../../shared/slide-edit';
import { openSlideEditor, useEditor } from './editor-store';
import { newSlide } from './ops';

const doc: EditDoc = {
  presentationId: 'placeholder-pdf',
  name: 'Placeholder PDF',
  width: 480,
  height: 320,
  transition: null,
  loop: false,
  groups: [{ id: 'group', name: '', color: null, slides: [{ ...newSlide(null), id: 'page' }] }],
};
const result = (sourceIssues?: string[]): EditSlidesResult => ({
  ok: true,
  doc,
  stamp: 'placeholder-stamp',
  look: {
    langs: {},
    background: null,
    frame: { x: 10, y: 10, width: 460, height: 300 },
    style: {
      fontFamily: null,
      fontSize: 28,
      fontWeight: 400,
      color: '#ffffff',
      align: 'left',
      verticalAlign: 'top',
      lineHeight: 1.2,
      shadow: false,
    },
  },
  unreadable: 0,
  ...(sourceIssues ? { sourceIssues } : {}),
});

afterEach(() => vi.unstubAllGlobals());

describe('source document limits in the editor view', () => {
  it('retains preparation limits from the existing open API and clears them on the next clean open', async () => {
    const issues = ['Placeholder source objects could not be prepared safely. Saved playback is unchanged.'];
    const slidesForEdit = vi
      .fn<() => Promise<EditSlidesResult>>()
      .mockResolvedValueOnce(result(issues))
      .mockResolvedValueOnce(result());
    vi.stubGlobal('window', { drashti: { library: { slidesForEdit } } });

    await openSlideEditor(doc.presentationId, doc.name);
    expect(useEditor.getState()).toHaveProperty('sourceIssues', issues);
    expect(useEditor.getState().doc).toBe(doc);
    expect(useEditor.getState().past).toEqual([]);

    await openSlideEditor(doc.presentationId, doc.name);
    expect(useEditor.getState()).toHaveProperty('sourceIssues', []);
    expect(useEditor.getState().doc).toBe(doc);
    expect(useEditor.getState().past).toEqual([]);
  });
});
