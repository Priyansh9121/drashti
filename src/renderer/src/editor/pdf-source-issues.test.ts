import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  EditDoc,
  EditSlidesResult,
  EditSourceRequest,
  EditSourceUpdate,
  EditSlide,
} from '../../../shared/slide-edit';
import { commit, isDirty, openSlideEditor, undo, useEditor } from './editor-store';
import { addSlideAfter, changeSlide, copySlide, newSlide } from './ops';

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

describe('a page still being read from its PDF (Session 57, C2 part 1)', () => {
  const PREPARING_NOTE =
    'Pages marked Preparing… are still being read from their PDF. Try again once they’re ready.';
  const imported: EditSlide = {
    ...newSlide(null),
    id: 'imported-page',
    documentPage: { sha256: 'a'.repeat(64), ext: 'pdf', page: 3 },
    sourceOccurrenceId: 'imported-page',
  };
  const importedDoc: EditDoc = {
    ...doc,
    groups: [{ id: 'group', name: '', color: null, slides: [imported] }],
  };

  async function openPreparing(opening: EditDoc) {
    let request: EditSourceRequest | undefined;
    let receive: ((update: EditSourceUpdate) => void) | undefined;
    const opened = result();
    if (!opened.ok) throw new Error(opened.message);
    vi.stubGlobal('window', {
      drashti: {
        library: {
          slidesForEdit: (_id: string, pending: EditSourceRequest) => {
            request = pending;
            return Promise.resolve({ ...opened, doc: opening, preparingSource: ['imported-page'] });
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
    await openSlideEditor(opening.presentationId, opening.name);
    if (!request || !receive) throw new Error('Missing PDF update subscription.');
    const { requestId } = request;
    const deliver = receive;
    return (update: { pages: EditSlide[]; settled: string[] }) => deliver({ requestId, ...update });
  }
  const shown = () => useEditor.getState().doc?.groups[0]?.slides ?? [];

  it('can’t be changed or copied until it is ready, says so, and still takes its notes', async () => {
    const deliver = await openPreparing(importedDoc);
    const before = useEditor.getState().doc;
    if (!before) throw new Error('The editor did not open.');
    commit(changeSlide(before, imported.id, { background: '#000000' }));
    expect(useEditor.getState().doc).toBe(before);
    expect(useEditor.getState().note).toBe(PREPARING_NOTE);
    commit(addSlideAfter(before, imported.id, copySlide(imported)));
    expect(useEditor.getState().doc).toBe(before);
    expect(isDirty(useEditor.getState())).toBe(false);
    // Its notes never make it a picture page: they still change.
    commit(changeSlide(before, imported.id, { notes: 'Placeholder notes while preparing' }));
    expect(shown()[0]?.notes).toBe('Placeholder notes while preparing');
    // Once it is ready, it changes as any page does.
    deliver({ pages: [{ ...imported, background: '#123456' }], settled: [imported.id] });
    const ready = useEditor.getState().doc;
    if (!ready) throw new Error('The editor closed.');
    commit(changeSlide(ready, imported.id, { background: '#000000' }));
    expect(shown()[0]?.background).toBe('#000000');
    commit(addSlideAfter(useEditor.getState().doc ?? ready, imported.id, copySlide(imported)));
    expect(shown()).toHaveLength(2);
  });

  it('takes a prepared page’s deck with it, keeping the editor’s own transitions', async () => {
    const own = { transition: { kind: 'fade' as const, durationMs: 400 }, mode: 'over' as const };
    const stored = {
      ...imported,
      deck: { steps: [], media: [], stepTransitions: { 1: own } },
    } satisfies EditSlide;
    const deliver = await openPreparing({
      ...doc,
      groups: [{ id: 'group', name: '', color: null, slides: [stored] }],
    });
    // The editor sets its own transition into the slide while the page is read.
    const opened = useEditor.getState().doc;
    if (!opened) throw new Error('The editor did not open.');
    commit(changeSlide(opened, stored.id, { deck: { ...stored.deck, drashti: own } }));
    const motion = { effects: [], stepsMs: [400, 600], approximate: false };
    deliver({
      pages: [
        {
          ...stored,
          deck: { steps: [], media: [], motion, transition: { name: 'Placeholder', durationMs: 300 } },
        },
      ],
      settled: [stored.id],
    });
    expect(shown()[0]?.deck).toEqual({
      steps: [],
      media: [],
      motion,
      transition: { name: 'Placeholder', durationMs: 300 },
      drashti: own,
      stepTransitions: { 1: own },
    });
  });
});
