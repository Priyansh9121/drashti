import { beforeEach, describe, expect, it } from 'vitest';
import type { ShapeElement } from '../../../shared/model';
import type { EditDoc } from '../../../shared/slide-edit';
import { commit, noteOutside, redo, select, undo, useEditor } from './editor-store';
import { changeSlide, mapSlide, setShapeFill } from './ops';

/*
 * Undo and Redo for every change made in the slide editor (Session 55, Part 17a): the presentation's own changes, and
 * those it makes outside the presentation at once (Drashti's default transition, a timer's own time and kind), in the
 * order they were made, one step each, back and forth.
 */

const doc: EditDoc = {
  presentationId: 'p',
  name: 'Placeholder Undo',
  width: 1920,
  height: 1080,
  transition: null,
  loop: false,
  groups: [
    {
      id: 'g',
      name: 'Verse',
      color: null,
      slides: [
        {
          id: 's',
          label: '',
          notes: '',
          background: null,
          darken: null,
          enabled: true,
          transition: null,
          autoAdvanceMs: null,
          macroId: null,
          elements: [],
          cues: [],
        },
      ],
    },
  ],
};

describe('the editor’s Undo and Redo', () => {
  beforeEach(() => {
    useEditor.setState({
      open: { presentationId: 'p', name: 'Placeholder Undo' },
      doc,
      opened: doc,
      slideId: 's',
      past: [],
      future: [],
      editing: null,
      selection: [],
      coalesce: null,
    });
  });

  it('expands a visible selection to its hidden group member and can still select a member alone', () => {
    const frame = { x: 0, y: 0, width: 200, height: 100 };
    const shape = { kind: 'shape' as const, frame, fill: '#336699', opacity: 1, cornerRadius: 0 };
    const grouped = mapSlide(doc, 's', (slide) => ({
      ...slide,
      elements: [
        { ...shape, id: 'one', groupId: 'group', hidden: true },
        { ...shape, id: 'two', groupId: 'group' },
        { ...shape, id: 'outside', hidden: true },
      ],
    }));
    useEditor.setState({ doc: grouped });

    select(['two']);
    expect(useEditor.getState().selection).toEqual(['one', 'two']);
    select(['two'], { expandGroups: false });
    expect(useEditor.getState().selection).toEqual(['two']);
    expect(useEditor.getState().doc).toBe(grouped);
  });

  it('takes back a change made outside the presentation in its turn, and gives it again', () => {
    const said: string[] = [];
    commit(changeSlide(doc, 's', { label: 'Placeholder one' }));
    noteOutside({
      undo: () => said.push('default back'),
      redo: () => said.push('default again'),
    });
    commit(changeSlide(useEditor.getState().doc ?? doc, 's', { label: 'Placeholder two' }));
    const label = () => useEditor.getState().doc?.groups[0]?.slides[0]?.label;

    undo();
    expect(label()).toBe('Placeholder one');
    expect(said).toEqual([]);
    undo();
    expect(said).toEqual(['default back']);
    expect(label()).toBe('Placeholder one');
    undo();
    expect(label()).toBe('');
    expect(useEditor.getState().past).toHaveLength(0);

    redo();
    expect(label()).toBe('Placeholder one');
    redo();
    expect(said).toEqual(['default back', 'default again']);
    redo();
    expect(label()).toBe('Placeholder two');
    expect(useEditor.getState().future).toHaveLength(0);
  });

  it('a new change after Undo leaves nothing to redo, outside changes too', () => {
    noteOutside({ undo: () => undefined, redo: () => undefined });
    undo();
    expect(useEditor.getState().future).toHaveLength(1);
    commit(changeSlide(doc, 's', { label: 'Placeholder new' }));
    expect(useEditor.getState().future).toHaveLength(0);
  });

  it('the presentation counts as changed only for its own changes', () => {
    noteOutside({ undo: () => undefined, redo: () => undefined });
    expect(useEditor.getState().doc).toBe(useEditor.getState().opened);
  });
});

it.each([null, '#336699'])('removes the gradient property when Fill becomes %s', (fill) => {
  const shape: ShapeElement = {
    id: 'placeholder-gradient',
    kind: 'shape',
    frame: { x: 0, y: 0, width: 100, height: 60 },
    fill: '#000000',
    cornerRadius: 0,
    opacity: 1,
    gradient: {
      kind: 'linear',
      angle: 0,
      stops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#ffffff' },
      ],
    },
  };
  const changed = setShapeFill(shape, fill);
  expect(changed).toHaveProperty('fill', fill);
  expect(changed).not.toHaveProperty('gradient');
  expect(shape.gradient).toBeDefined();
});
