import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  EditDoc,
  EditSlidesResult,
  EditSourceRequest,
  EditSourceUpdate,
} from '../../../shared/slide-edit';
import { commit, isDirty, openSlideEditor, undo, useEditor } from './editor-store';
import { changeSlide, newSlide } from './ops';

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
    vi.stubGlobal('window', {
      drashti: { library: { slidesForEdit }, slideEditor: { onSourcePrepared: () => () => undefined } },
    });

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

it('keeps the newly editable page through an undo of earlier notes edits', async () => {
  let request: EditSourceRequest | undefined;
  let receive: ((update: EditSourceUpdate) => void) | undefined;
  const opened = result();
  if (!opened.ok) throw new Error(opened.message);
  const slide = opened.doc.groups[0]?.slides[0];
  if (!slide) throw new Error('Missing placeholder page.');
  vi.stubGlobal('window', {
    drashti: {
      library: {
        slidesForEdit: (_id: string, pending: EditSourceRequest) => {
          request = pending;
          return Promise.resolve({ ...opened, preparingSource: [slide.id] });
        },
      },
      slideEditor: {
        onSourcePrepared: (listener: typeof receive) => {
          receive = listener;
          return () => {
            receive = undefined;
          };
        },
      },
    },
  });
  await openSlideEditor(doc.presentationId, doc.name);
  expect(useEditor.getState().preparingSource.has(slide.id)).toBe(true);
  commit(changeSlide(opened.doc, slide.id, { notes: 'Placeholder edit' }));
  if (!request || !receive) throw new Error('Missing PDF update subscription.');
  const { requestId } = request;
  receive({ requestId, pages: [{ ...slide, background: '#123456' }], settled: [slide.id] });
  expect(useEditor.getState().preparingSource.has(slide.id)).toBe(false);
  expect(useEditor.getState().doc?.groups[0]?.slides[0]).toMatchObject({
    notes: 'Placeholder edit',
    background: '#123456',
  });
  expect(isDirty(useEditor.getState())).toBe(true);
  undo();
  expect(useEditor.getState().doc?.groups[0]?.slides[0]).toMatchObject({
    notes: slide.notes,
    background: '#123456',
  });
  expect(isDirty(useEditor.getState())).toBe(false);
  receive({ requestId, issues: [] });
});
