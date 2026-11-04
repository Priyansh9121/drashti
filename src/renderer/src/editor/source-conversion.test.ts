import { beforeEach, describe, expect, it } from 'vitest';
import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import {
  acceptSourceConversion,
  allowSourceContent,
  beginGesture,
  cancelSourceConversion,
  commit,
  endGesture,
  noteMade,
  showSlide,
  startEditing,
  stopEditing,
  undo,
  updateGesture,
  useEditor,
} from './editor-store';
import { addElement, changeSlide, findSlide, mapElements } from './ops';
import { sourceContentChanges } from './source-conversion';

const page = (id: string, animated = true): EditSlide => ({
  id,
  label: '',
  notes: '',
  background: null,
  darken: null,
  enabled: true,
  transition: null,
  autoAdvanceMs: null,
  macroId: null,
  cues: [],
  documentPage: { sha256: 'a'.repeat(64), ext: 'pptx', page: id === 'first' ? 0 : 1 },
  ...(animated ? { deck: { steps: [{ clipId: 'clip', clipMs: 100, lastId: 'still' }], media: [] } } : {}),
  elements: [
    {
      id: `words-${id}`,
      kind: 'text',
      text: 'Placeholder source words',
      lang: null,
      frame: { x: 10, y: 10, width: 500, height: 100 },
      style: {
        fontFamily: null,
        fontSize: 40,
        fontWeight: 400,
        color: '#ffffff',
        align: 'left',
        verticalAlign: 'top',
        lineHeight: 1.35,
        shadow: false,
      },
    },
  ],
});
const document = (): EditDoc => ({
  presentationId: 'source',
  name: 'Placeholder source',
  width: 960,
  height: 540,
  transition: null,
  loop: false,
  groups: [{ id: 'group', name: 'Placeholder', color: null, slides: [page('first'), page('second')] }],
});

describe('the imported animated slide conversion gate', () => {
  beforeEach(() => {
    cancelSourceConversion();
    const doc = document();
    useEditor.setState({
      open: { presentationId: doc.presentationId, name: doc.name },
      doc,
      opened: doc,
      slideId: 'first',
      selection: [],
      editing: null,
      past: [],
      future: [],
      gesture: null,
      coalesce: null,
      made: [],
      sourceConversion: null,
      group: 'words',
      previewAt: null,
    });
    // Changing the shown slide clears any abandoned acknowledgement from a previous test.
    showSlide('first');
  });

  it('asks before mounting a text editor; Cancel changes no document, history or preview', () => {
    const before = useEditor.getState();
    startEditing('words-first');
    expect(useEditor.getState().sourceConversion?.slideIds).toEqual(['first']);
    expect(useEditor.getState().editing).toBeNull();
    expect(useEditor.getState().doc).toBe(before.doc);
    cancelSourceConversion();
    expect(useEditor.getState().sourceConversion).toBeNull();
    expect(useEditor.getState().doc).toBe(before.doc);
    expect(useEditor.getState().past).toEqual([]);
    expect(useEditor.getState().previewAt).toBeNull();
    startEditing('words-first');
    expect(useEditor.getState().sourceConversion?.slideIds).toEqual(['first']);
  });

  it('acknowledges without changing a page, then converts with the first actual edit in one Undo', () => {
    const before = useEditor.getState().doc;
    if (!before) throw new Error('placeholder doc missing');
    startEditing('words-first');
    acceptSourceConversion();
    expect(useEditor.getState().editing).toBe('words-first');
    expect(useEditor.getState().doc).toBe(before);
    expect(useEditor.getState().past).toHaveLength(0);
    commit(
      mapElements(before, 'first', ['words-first'], (element) =>
        element.kind === 'text' ? { ...element, text: 'Placeholder revised words' } : element,
      ),
    );
    stopEditing();
    const changed = useEditor.getState().doc;
    if (!changed) throw new Error('changed doc missing');
    expect(findSlide(changed, 'first')?.deck).toBeUndefined();
    expect(findSlide(changed, 'first')?.documentPage?.edited).toBe(true);
    expect(findSlide(changed, 'second')).toBe(findSlide(before, 'second'));
    expect(useEditor.getState().past).toEqual([before]);
    undo();
    expect(useEditor.getState().doc).toBe(before);
    startEditing('words-first');
    expect(useEditor.getState().sourceConversion?.slideIds).toEqual(['first']);
  });

  it('does not carry unused acknowledgement after leaving typing without editing', () => {
    startEditing('words-first');
    acceptSourceConversion();
    stopEditing();
    expect(useEditor.getState().past).toHaveLength(0);
    startEditing('words-first');
    expect(useEditor.getState().sourceConversion?.slideIds).toEqual(['first']);
  });

  it('holds direct Insert/style/Arrange commits until acceptance, then applies their exact edit', () => {
    const before = useEditor.getState().doc;
    if (!before) throw new Error('placeholder doc missing');
    const next = changeSlide(before, 'first', { background: '#123456' });
    commit(next);
    expect(useEditor.getState().doc).toBe(before);
    expect(useEditor.getState().past).toHaveLength(0);
    acceptSourceConversion();
    expect(findSlide(useEditor.getState().doc ?? before, 'first')?.background).toBe('#123456');
    expect(findSlide(useEditor.getState().doc ?? before, 'first')?.deck).toBeUndefined();
    expect(useEditor.getState().past).toEqual([before]);
  });

  it('keeps Insert Text out of the canvas until accepted, then resumes typing; Cancel leaves no made element', () => {
    const before = useEditor.getState().doc;
    const first = before ? findSlide(before, 'first') : undefined;
    const words = first?.elements[0];
    if (!before || !first || words?.kind !== 'text') throw new Error('placeholder words missing');
    const added = { ...words, id: 'new-words', text: 'Placeholder new words' };
    const next = addElement(before, 'first', added);
    useEditor.setState({ group: 'insert' });
    noteMade(added.id);
    commit(next, { select: [added.id] });
    useEditor.setState({ group: 'words' });
    startEditing(added.id);
    expect(useEditor.getState().editing).toBeNull();
    expect(useEditor.getState().doc).toBe(before);
    cancelSourceConversion();
    expect(useEditor.getState().group).toBe('insert');
    expect(useEditor.getState().made).not.toContain(added.id);
    expect(useEditor.getState().past).toHaveLength(0);
    noteMade(added.id);
    commit(next, { select: [added.id] });
    startEditing(added.id);
    acceptSourceConversion();
    expect(useEditor.getState().editing).toBe(added.id);
    expect(useEditor.getState().past).toEqual([before]);
    expect(findSlide(useEditor.getState().doc ?? before, 'first')?.documentPage?.edited).toBe(true);
  });

  it('still blocks a direct gesture update before publishing content when its caller missed the intent gate', () => {
    const before = useEditor.getState().doc;
    if (!before) throw new Error('placeholder doc missing');
    beginGesture();
    updateGesture(changeSlide(before, 'first', { background: '#123456' }));
    expect(useEditor.getState().sourceConversion?.slideIds).toEqual(['first']);
    expect(useEditor.getState().doc).toBe(before);
    expect(useEditor.getState().gesture).toBeNull();
    expect(useEditor.getState().past).toHaveLength(0);
    cancelSourceConversion();
    expect(useEditor.getState().doc).toBe(before);
  });

  it('rejects a drag before its live preview and keeps later drag updates in one converted step', () => {
    const before = useEditor.getState().doc;
    if (!before) throw new Error('placeholder doc missing');
    expect(allowSourceContent('first')).toBe(false);
    expect(useEditor.getState().doc).toBe(before);
    expect(useEditor.getState().gesture).toBeNull();
    acceptSourceConversion();
    expect(allowSourceContent('first')).toBe(true);
    beginGesture();
    updateGesture(changeSlide(before, 'first', { background: '#123456' }));
    updateGesture(changeSlide(before, 'first', { background: '#654321' }));
    endGesture();
    expect(useEditor.getState().past).toEqual([before]);
    expect(findSlide(useEditor.getState().doc ?? before, 'first')?.documentPage?.edited).toBe(true);
    expect(findSlide(useEditor.getState().doc ?? before, 'first')?.deck).toBeUndefined();
    undo();
    expect(useEditor.getState().doc).toBe(before);
    expect(allowSourceContent('first')).toBe(false);
  });

  it('does not convert notes, hide, transitions, guides or a reorder', () => {
    const before = useEditor.getState().doc;
    if (!before) throw new Error('placeholder doc missing');
    const metadata = changeSlide(before, 'first', {
      notes: 'Placeholder notes',
      enabled: false,
      transition: { kind: 'dissolve', durationMs: 300 },
      guides: { x: [20], y: [40] },
    });
    expect(sourceContentChanges(before, metadata)).toEqual([]);
    commit(metadata);
    expect(useEditor.getState().sourceConversion).toBeNull();
    expect(findSlide(useEditor.getState().doc ?? before, 'first')?.deck).toBe(
      findSlide(before, 'first')?.deck,
    );
    expect(findSlide(useEditor.getState().doc ?? before, 'first')?.documentPage?.edited).toBeUndefined();
    const reordered = {
      ...metadata,
      groups: metadata.groups.map((group) => ({ ...group, slides: [...group.slides].reverse() })),
    };
    expect(sourceContentChanges(metadata, reordered)).toEqual([]);
  });

  it('marks a static source derivative edited without warning and preserves a real no-op', () => {
    const before = document();
    const first = findSlide(before, 'first');
    if (!first) throw new Error('placeholder slide missing');
    delete first.deck;
    useEditor.setState({ doc: before, opened: before });
    const noop = mapElements(
      before,
      'first',
      first.elements.map((element) => element.id),
      (element) => ({ ...element }),
    );
    expect(sourceContentChanges(before, noop)).toEqual([]);
    commit(changeSlide(before, 'first', { background: '#abcdef' }));
    expect(useEditor.getState().sourceConversion).toBeNull();
    expect(findSlide(useEditor.getState().doc ?? before, 'first')?.documentPage?.edited).toBe(true);
  });
});
