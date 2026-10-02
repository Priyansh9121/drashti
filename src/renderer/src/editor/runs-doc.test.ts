import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import type { TextElement, TextRun } from '../../../shared/model';
import type { EditDoc } from '../../../shared/slide-edit';
import { arrange, duplicateElements, patchRun, styleBox } from './ops';
import { docOf, restyle, runsOf, selectedLook, textSchema, withRuns } from './runs-doc';

const schema = textSchema(() => ({}));

const box = (runs?: TextRun[], text = runs?.map((r) => r.text).join('') ?? ''): TextElement => ({
  id: 'b',
  kind: 'text',
  frame: { x: 0, y: 0, width: 800, height: 300 },
  text,
  lang: null,
  style: {
    fontFamily: null,
    fontSize: 80,
    fontWeight: 500,
    color: '#ffffff',
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.2,
    shadow: true,
  },
  ...(runs ? { runs } : {}),
});

describe('words in the text editor and back', () => {
  it('gives runs back exactly: looks, line breaks (with the look they had) and all', () => {
    const runs: TextRun[] = [
      { text: 'નમૂના પંક્તિ\n', size: 88, lang: 'gu', shadow: { color: '#000000', blur: 4, x: 2, y: 2 } },
      { text: 'Namūnā pankti', size: 60, italic: true, lang: 'translit', outline: null },
      { text: '\n\n', size: 60 },
      { text: 'Placeholder', font: null, color: '#ffcc00', outline: { color: '#ff0000', width: 2 } },
    ];
    expect(runsOf(docOf(schema, box(runs)))).toEqual(runs);
  });

  it('keeps legacy-font text as it is', () => {
    const runs: TextRun[] = [{ text: 'nmUnO pHelI', font: 'Gopika', legacy: true, lang: null }];
    expect(runsOf(docOf(schema, box(runs)))).toEqual(runs);
  });

  it('reads a box without runs as plain text, and gives plain text back', () => {
    const plain = box(undefined, 'Placeholder one\nPlaceholder two');
    const runs = runsOf(docOf(schema, plain));
    expect(runs).toEqual([{ text: 'Placeholder one\nPlaceholder two' }]);
    expect(withRuns(plain, runs)).toEqual({ ...plain, lang: 'en' });
  });

  it('joins neighbours that end up with the same look, and leaves out empty text', () => {
    const runs = runsOf(docOf(schema, box([{ text: 'a', size: 50 }, { text: '' }, { text: 'b', size: 50 }])));
    expect(runs).toEqual([{ text: 'ab', size: 50 }]);
  });

  it('gives words typed in a new box their language’s look from the theme, line by line', () => {
    const fresh = box();
    const typed = withRuns(fresh, [{ text: 'નમૂના\nNamuna placeholder' }], {
      gu: { size: 88, weight: 500 },
      en: { size: 80 },
    });
    expect(typed.runs).toEqual([
      { text: 'નમૂના\n', size: 88, weight: 500, lang: 'gu' },
      { text: 'Namuna placeholder', size: 80, lang: 'en' },
    ]);
    expect(typed.lang).toBe('gu');
  });

  it('gives the selected words a new look, and only them', () => {
    const doc = docOf(schema, box([{ text: 'Placeholder words here', size: 70 }]));
    // "words" (positions count from the start of the block, which is 1).
    let state = EditorState.create({ doc, schema });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 13, 18)));
    expect(selectedLook(state)).toEqual({ size: 70 });
    state = state.apply(restyle(state, { color: '#ff0000', outline: { color: '#000000', width: 2 } }));
    expect(runsOf(state.doc)).toEqual([
      { text: 'Placeholder ', size: 70 },
      { text: 'words', size: 70, color: '#ff0000', outline: { color: '#000000', width: 2 } },
      { text: ' here', size: 70 },
    ]);
    // Going back to the box's colour drops the run's own.
    state = state.apply(restyle(state, { color: undefined }));
    expect(runsOf(state.doc)[1]).toEqual({
      text: 'words',
      size: 70,
      outline: { color: '#000000', width: 2 },
    });
  });
});

describe('styling a whole box', () => {
  it('sets the box’s style and lets its words follow it, keeping legacy-font words in their font', () => {
    const el = box([
      { text: 'નમૂના\n', size: 88, color: '#ffcc00', lang: 'gu' },
      { text: 'nmUnO', font: 'Gopika', legacy: true },
    ]);
    const styled = styleBox(el, { size: 64, color: '#00ff00', font: 'Placeholder Sans' }, { align: 'left' });
    expect(styled.style).toMatchObject({
      fontSize: 64,
      color: '#00ff00',
      fontFamily: 'Placeholder Sans',
      align: 'left',
    });
    expect(styled.runs).toEqual([
      { text: 'નમૂના\n', lang: 'gu' },
      { text: 'nmUnO', font: 'Gopika', legacy: true },
    ]);
  });

  it('turns shadows and outlines on and off for the whole box', () => {
    const el = box([{ text: 'Placeholder', shadow: false, outline: { color: '#ff0000', width: 1 } }]);
    const on = styleBox(el, {
      shadow: { color: '#000000', blur: 3, x: 1, y: 1 },
      outline: { color: '#ffffff', width: 4 },
    });
    expect(on.style).toMatchObject({
      shadow: { color: '#000000', blur: 3, x: 1, y: 1 },
      outline: { color: '#ffffff', width: 4 },
    });
    // Its words follow the box now, so there are no runs left.
    expect(on.runs).toBeUndefined();
    const off = styleBox(on, { shadow: false, outline: null });
    expect(off.style.shadow).toBe(false);
    expect(off.style.outline).toBeUndefined();
  });

  it('patches a run: a value sets it, undefined goes back to the box', () => {
    expect(patchRun({ text: 'x', size: 50, color: '#ff0000' }, { size: 60, color: undefined })).toEqual({
      text: 'x',
      size: 60,
    });
  });
});

describe('arranging and copying elements', () => {
  const doc: EditDoc = {
    presentationId: 'p',
    name: 'Placeholder',
    width: 1920,
    height: 1080,
    transition: null,
    loop: false,
    groups: [
      {
        id: 'g',
        name: 'A',
        color: null,
        slides: [
          {
            id: 's',
            label: '',
            notes: '',
            background: null,
            enabled: true,
            transition: null,
            autoAdvanceMs: null,
            cues: [],
            elements: ['a', 'b', 'c', 'd'].map((id) => ({ ...box(undefined, id), id })),
          },
        ],
      },
    ],
  };
  const order = (d: EditDoc) => d.groups[0]?.slides[0]?.elements.map((e) => e.id);

  it('brings to the front, sends back, and steps one place', () => {
    expect(order(arrange(doc, 's', ['b'], 'front'))).toEqual(['a', 'c', 'd', 'b']);
    expect(order(arrange(doc, 's', ['c'], 'back'))).toEqual(['c', 'a', 'b', 'd']);
    expect(order(arrange(doc, 's', ['a', 'b'], 'forward'))).toEqual(['c', 'a', 'b', 'd']);
    expect(order(arrange(doc, 's', ['c'], 'backward'))).toEqual(['a', 'c', 'b', 'd']);
    // Already at the top: nothing moves.
    expect(order(arrange(doc, 's', ['d'], 'forward'))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('copies elements on top, a little down and to the right, with new ids', () => {
    const { doc: next, ids } = duplicateElements(doc, 's', ['a'], 24);
    const els = next.groups[0]?.slides[0]?.elements ?? [];
    expect(els).toHaveLength(5);
    expect(els.at(-1)?.id).toBe(ids[0]);
    expect(ids[0]).not.toBe('a');
    expect(els.at(-1)?.frame).toEqual({ x: 24, y: 24, width: 800, height: 300 });
  });
});
