import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import type { TextElement, TextRun } from '../../../shared/model';
import type { EditDoc } from '../../../shared/slide-edit';
import { arrange, duplicateElements, patchRun, styleBox } from './ops';
import {
  docOf,
  indentLine,
  listLines,
  outdentLine,
  pasteText,
  restyle,
  runsOf,
  selectedList,
  selectedLook,
  splitLine,
  textSchema,
  unlistAtStart,
  withRuns,
} from './runs-doc';

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
            darken: null,
            enabled: true,
            transition: null,
            autoAdvanceMs: null,
            macroId: null,
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

describe('a list, line by line, in the text editor (Session 55, Part 17a)', () => {
  /** An editor's state on a box's words, the caret (or the selection) at these places. */
  const stateOf = (runs: TextRun[] | undefined, text: string | undefined, from: number, to = from) => {
    const el = box(runs, text);
    const state = EditorState.create({ doc: docOf(schema, el), schema });
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
  };
  /** Run a command, as a key would. */
  const run = (
    state: EditorState,
    command: (s: EditorState, d?: (tr: import('prosemirror-state').Transaction) => void) => boolean,
  ) => {
    let next = state;
    const done = command(state, (tr) => {
      next = state.apply(tr);
    });
    return { done, state: next };
  };

  it('gives a list back exactly: its marks, its levels and its line breaks', () => {
    const runs: TextRun[] = [
      { text: 'Placeholder title\n', size: 90 },
      { text: 'one\n', list: '1' },
      { text: 'further in\n', list: 'a', level: 1, color: '#ffcc00' },
      { text: 'two', list: '1', underline: true },
    ];
    expect(runsOf(docOf(schema, box(runs)))).toEqual(runs);
  });

  it('makes the lines the selection touches a list, and only them; and takes them out again', () => {
    // "one" starts at 20: the title's line is 17 letters and its two ends (1 + 17 + 1), then the next line opens.
    const state = stateOf(undefined, 'Placeholder title\none\ntwo', 21, 26);
    expect(selectedList(state)).toEqual({ mark: null, level: 0 });
    const listed = state.apply(listLines(state, { mark: 'disc' }));
    expect(runsOf(listed.doc)).toEqual([{ text: 'Placeholder title\n' }, { text: 'one\ntwo', list: 'disc' }]);
    expect(selectedList(listed)).toEqual({ mark: 'disc', level: 0 });
    const back = listed.apply(listLines(listed, null));
    expect(runsOf(back.doc)).toEqual([{ text: 'Placeholder title\none\ntwo' }]);
  });

  it('Enter goes on with the list; on an empty line of it, Enter leaves the list', () => {
    let state = stateOf([{ text: 'one', list: 'disc' }], undefined, 4);
    let step = run(state, splitLine);
    expect(step.done).toBe(true);
    state = step.state;
    state = state.apply(state.tr.insertText('two'));
    expect(runsOf(state.doc)).toEqual([{ text: 'one\ntwo', list: 'disc' }]);
    state = run(state, splitLine).state;
    expect(selectedList(state)).toEqual({ mark: 'disc', level: 0 });
    step = run(state, splitLine);
    expect(step.done).toBe(true);
    expect(selectedList(step.state)).toEqual({ mark: null, level: 0 });
    expect(runsOf(step.state.doc)).toEqual([{ text: 'one\ntwo\n', list: 'disc' }]);
    // Outside a list, Enter is a new line, as it always was.
    const plain = run(stateOf(undefined, 'Placeholder', 6), splitLine).state;
    expect(runsOf(plain.doc)).toEqual([{ text: 'Place\nholder' }]);
  });

  it('Backspace at the start of a list’s line takes its mark off first; Tab and Shift+Tab move it in and out', () => {
    // The start of "two": 1 + "one" + 1, then 1.
    const state = stateOf([{ text: 'one\ntwo', list: 'disc' }], undefined, 6);
    const tabbed = run(state, indentLine);
    expect(tabbed.done).toBe(true);
    expect(runsOf(tabbed.state.doc)).toEqual([
      { text: 'one\n', list: 'disc' },
      { text: 'two', list: 'disc', level: 1 },
    ]);
    expect(selectedList(tabbed.state)).toEqual({ mark: 'disc', level: 1 });
    expect(runsOf(run(tabbed.state, outdentLine).state.doc)).toEqual([{ text: 'one\ntwo', list: 'disc' }]);
    const unlisted = run(state, unlistAtStart);
    expect(unlisted.done).toBe(true);
    expect(runsOf(unlisted.state.doc)).toEqual([{ text: 'one\n', list: 'disc' }, { text: 'two' }]);
    // Not a list's line, or not at its start: the keys do what they always did.
    expect(run(unlisted.state, unlistAtStart).done).toBe(false);
    expect(run(unlisted.state, indentLine).done).toBe(false);
    expect(run(stateOf([{ text: 'one\ntwo', list: 'disc' }], undefined, 7), unlistAtStart).done).toBe(false);
  });

  it('pastes lines as lines, the list going on through them', () => {
    const state = stateOf([{ text: 'one', list: 'disc', color: '#ffcc00' }], undefined, 4);
    const pasted = state.apply(pasteText(state, ' more\nPlaceholder pasted\r\nlast'));
    expect(runsOf(pasted.doc)).toEqual([
      { text: 'one more\nPlaceholder pasted\nlast', list: 'disc', color: '#ffcc00' },
    ]);
  });

  it('styles the selected words with the Words group’s new looks', () => {
    const state = stateOf([{ text: 'Placeholder words here', size: 70 }], undefined, 13, 18);
    const styled = state.apply(
      restyle(state, { underline: true, strike: true, glow: { color: '#00ffcc', size: 12 }, letterSpacing: 2 }),
    );
    expect(runsOf(styled.doc)[1]).toEqual({
      text: 'words',
      size: 70,
      underline: true,
      strike: true,
      glow: { color: '#00ffcc', size: 12 },
      letterSpacing: 2,
    });
  });
});

describe('the Words group on a whole box (Session 55, Part 17a)', () => {
  it('underlines and strikes through every word: plain words become a run to carry it', () => {
    const plain = box(undefined, 'Placeholder words');
    expect(styleBox(plain, { underline: true }).runs).toEqual([{ text: 'Placeholder words', underline: true }]);
    const struck = styleBox(box([{ text: 'a', size: 50 }, { text: 'b', underline: true }]), { strike: true });
    expect(struck.runs).toEqual([
      { text: 'a', size: 50, strike: true },
      { text: 'b', underline: true, strike: true },
    ]);
    // Off again: the runs no longer carry it.
    expect(styleBox(struck, { strike: false, underline: false }).runs).toEqual([{ text: 'a', size: 50 }, { text: 'b' }]);
  });

  it('gives the box a glow, its words following it; and spaces every word’s letters', () => {
    const el = box([{ text: 'a', glow: null }, { text: 'b', size: 50 }]);
    const glowing = styleBox(el, { glow: { color: '#00ffcc', size: 20 } });
    expect(glowing.style.glow).toEqual({ color: '#00ffcc', size: 20 });
    expect(glowing.runs).toEqual([{ text: 'a' }, { text: 'b', size: 50 }]);
    expect(styleBox(glowing, { glow: null }).style.glow).toBeUndefined();
    const spaced = styleBox(box(undefined, 'Placeholder'), { letterSpacing: 4 });
    expect(spaced.runs).toEqual([{ text: 'Placeholder', letterSpacing: 4 }]);
    expect(styleBox(spaced, { letterSpacing: undefined }).runs).toBeUndefined();
  });
});
