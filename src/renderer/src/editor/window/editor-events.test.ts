import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextElement } from '../../../../shared/model';
import type { EditDoc } from '../../../../shared/slide-edit';
import { commit, setCloseWindow, stopEditing, useEditor } from '../editor-store';
import { findSlide, mapElements, newSlide } from '../ops';
import { finishTextEditing } from '../TextBoxEditor';
import { closeAsked, editAsked, editorHasChanges } from './editor-events';

vi.mock('../TextBoxEditor', () => ({ finishTextEditing: vi.fn() }));

const box: TextElement = {
  id: 'box',
  kind: 'text',
  frame: { x: 0, y: 0, width: 800, height: 300 },
  text: 'Placeholder original',
  lang: 'en',
  style: {
    fontFamily: null,
    fontSize: 80,
    fontWeight: 400,
    color: '#ffffff',
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.2,
    shadow: false,
  },
};
const doc: EditDoc = {
  presentationId: 'p',
  name: 'Placeholder typing',
  width: 1920,
  height: 1080,
  transition: null,
  loop: false,
  groups: [
    {
      id: 'g',
      name: 'Placeholder group',
      color: null,
      slides: [
        { ...newSlide(null), id: 'first', elements: [box] },
        { ...newSlide(null), id: 'second' },
      ],
    },
  ],
};
const closed = vi.fn();
const read = vi.fn(() => Promise.resolve({ ok: false as const, message: 'Placeholder unavailable' }));
const words = () => findSlide(useEditor.getState().doc ?? doc, 'first')?.elements[0];

beforeEach(() => {
  closed.mockClear();
  read.mockClear();
  vi.stubGlobal('window', { drashti: { library: { slidesForEdit: read } } });
  setCloseWindow(closed);
  useEditor.setState({
    open: { presentationId: 'p', name: doc.name },
    doc,
    opened: doc,
    slideId: 'first',
    editing: 'box',
    past: [],
    future: [],
    coalesce: null,
    askDiscard: false,
    conflict: null,
    selection: ['box'],
  });
  // Only the text widget is stood in: its words remain pending until the window asks it to finish.
  // Navigation, change detection, Undo and the close decision use the real editor store.
  vi.mocked(finishTextEditing).mockImplementation(() => {
    const state = useEditor.getState();
    if (state.doc && state.editing)
      commit(
        mapElements(state.doc, 'first', ['box'], (el) =>
          el.kind === 'text' ? { ...el, text: 'Placeholder typed' } : el,
        ),
      );
    stopEditing();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setCloseWindow(() => undefined);
});

describe('pending words at the editor window’s boundaries', () => {
  it('keeps a window with active text editing open long enough for its page to decide about changes', () => {
    expect(editorHasChanges(useEditor.getState())).toBe(true);
  });

  it('commits pending words before closing asks, keeping one Undo and the window open', () => {
    closeAsked();
    expect(words()).toMatchObject({ text: 'Placeholder typed' });
    expect(useEditor.getState().askDiscard).toBe(true);
    expect(useEditor.getState().past).toHaveLength(1);
    expect(closed).not.toHaveBeenCalled();
  });

  it('keeps pending words when the operator asks for another slide in this presentation', () => {
    editAsked({ presentationId: 'p', slideId: 'second' });
    expect(words()).toMatchObject({ text: 'Placeholder typed' });
    expect(useEditor.getState().slideId).toBe('second');
    expect(useEditor.getState().past).toHaveLength(1);
    expect(read).not.toHaveBeenCalled();
  });

  it('asks before leaving pending words for another presentation', () => {
    editAsked({ presentationId: 'other', slideId: null });
    expect(useEditor.getState().open?.presentationId).toBe('p');
    expect(words()).toMatchObject({ text: 'Placeholder typed' });
    expect(useEditor.getState().askDiscard).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });

  it('closes without a question when text editing ends with nothing changed', () => {
    vi.mocked(finishTextEditing).mockImplementation(stopEditing);
    closeAsked();
    expect(closed).toHaveBeenCalledOnce();
    expect(useEditor.getState().askDiscard).toBe(false);
  });
});
