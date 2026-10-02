import { baseKeymap } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Mark } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { MarkViewConstructor } from 'prosemirror-view';
import { EditorView } from 'prosemirror-view';
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { TextElement } from '../../../shared/model';
import { HTML_LANG } from '../render/fonts';
import { runStyle, textBoxStyle, useShrinkToFit } from '../render/SlideView';
import { commit, stopEditing, useEditor } from './editor-store';
import { deleteElements, findSlide, mapElements } from './ops';
import type { Look } from './runs-doc';
import { docOf, runsOf, sameWords, textSchema, withRuns } from './runs-doc';

/*
 * Typing in a text box, in place on the slide: a ProseMirror editor drawn
 * exactly as the output draws the box. Input methods (Gujarati, Hindi)
 * work as in any text field; pasted text comes in as plain text. The words
 * go into the document when typing ends (Esc, a click elsewhere, saving),
 * as one step for the editor's Undo; inside the box, Undo undoes typing.
 */

interface ActiveText {
  view: EditorView;
  elementId: string;
  /** Put the typed words into the document (one step for Undo). */
  commit: () => void;
}

let active: ActiveText | null = null;

/** The text box being typed in, if any (the inspector styles its selected words). */
export function activeText(): ActiveText | null {
  return active;
}

/** Put the typed words into the document and stop typing. */
export function finishTextEditing(): void {
  active?.commit();
  stopEditing();
}

/** CSS properties as a style attribute. */
function cssText(style: CSSProperties): string {
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      const name = k.startsWith('Webkit') ? `-webkit-${k.slice(6)}` : k;
      return `${name.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)}: ${String(v)}`;
    })
    .join('; ');
}

/** How each run's text is drawn: as the renderer draws a run in this box. */
function markViews(el: TextElement): Record<string, MarkViewConstructor> {
  return {
    run: (mark: Mark) => {
      const look = mark.attrs['look'] as Look;
      const dom = document.createElement('span');
      dom.setAttribute('style', cssText(runStyle(look, el)));
      const lang = look.lang ?? el.lang;
      if (lang) dom.setAttribute('lang', HTML_LANG[lang]);
      if (look.lang) dom.dataset['lang'] = look.lang;
      if (look.legacy) dom.dataset['legacy'] = 'true';
      return { dom };
    },
  };
}

/** A line break (Enter and Shift+Enter): the box is one block, so lines are breaks in it. */
const lineBreak: Command = (state, dispatch) => {
  const br = state.schema.nodes['hard_break'];
  if (!br) return false;
  if (dispatch) {
    const marks = state.storedMarks ?? state.selection.$from.marks();
    dispatch(state.tr.replaceSelectionWith(br.create(null, null, marks)).scrollIntoView());
  }
  return true;
};

/** The words as the document should have them now; an emptied box made here goes away. */
function commitWords(view: EditorView, elementId: string, slideId: string): void {
  const s = useEditor.getState();
  if (!s.doc) return;
  const el = findSlide(s.doc, slideId)?.elements.find((e) => e.id === elementId);
  if (el?.kind !== 'text') return;
  const made = s.made.includes(elementId);
  const next = withRuns(el, runsOf(view.state.doc), made ? (s.look?.langs ?? {}) : undefined);
  if (made && next.text.trim() === '') {
    commit(deleteElements(s.doc, slideId, [elementId]), { select: [] });
    return;
  }
  if (!sameWords(next, el)) commit(mapElements(s.doc, slideId, [elementId], () => next));
}

export function TextBoxEditor({
  el,
  slideId,
  at,
}: {
  el: TextElement;
  slideId: string;
  /** Where the double-click was, for the caret; null puts it at the end. */
  at: { x: number; y: number } | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [typed, setTyped] = useState(0);
  useShrinkToFit(box, mount, el, typed);

  // One editor per box being typed in.
  useEffect(() => {
    const root = mount.current;
    if (!root) return;
    const schema = textSchema(() => ({}));
    const pm = new EditorView(
      { mount: root },
      {
        state: EditorState.create({
          doc: docOf(schema, el),
          plugins: [
            history(),
            keymap({
              'Mod-z': undo,
              'Mod-y': redo,
              'Shift-Mod-z': redo,
              Enter: lineBreak,
              'Shift-Enter': lineBreak,
            }),
            keymap(baseKeymap),
          ],
        }),
        markViews: markViews(el),
        attributes: {
          'data-testid': 'text-editing',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': 'Words of the text box',
          spellcheck: 'false',
          style: 'width: 100%; flex-shrink: 0; outline: none; caret-color: currentColor',
        },
        dispatchTransaction(tr) {
          pm.updateState(pm.state.apply(tr));
          setTyped((n) => n + 1);
          useEditor.setState((s) => ({ textTick: s.textTick + 1 }));
        },
        // Pasted text arrives as plain text, its lines as line breaks, in the look at the caret.
        handlePaste(v, event) {
          const text = event.clipboardData?.getData('text/plain') ?? '';
          const { state } = v;
          const marks = state.storedMarks ?? state.selection.$from.marks();
          const br = state.schema.nodes['hard_break'];
          const nodes = text
            .replace(/\r\n?/gu, '\n')
            .split('\n')
            .flatMap((line, i) => [
              ...(i > 0 && br ? [br.create(null, null, marks)] : []),
              ...(line === '' ? [] : [state.schema.text(line, marks)]),
            ]);
          let tr = state.tr.deleteSelection();
          for (const node of nodes) tr = tr.insert(tr.selection.from, node);
          v.dispatch(tr.scrollIntoView());
          return true;
        },
        // Nothing is dropped in: words are typed or pasted.
        handleDrop: () => true,
      },
    );
    view.current = pm;
    active = { view: pm, elementId: el.id, commit: () => commitWords(pm, el.id, slideId) };
    pm.focus();
    // The caret where the double-click was, or after the last word.
    const pos = at ? pm.posAtCoords({ left: at.x, top: at.y })?.pos : undefined;
    const doc = pm.state.doc;
    pm.dispatch(pm.state.tr.setSelection(TextSelection.create(doc, pos ?? doc.content.size - 1)));
    return () => {
      if (active?.view === pm) active = null;
      pm.destroy();
      view.current = null;
    };
    // The editor is made once per box; later changes to the box reach it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el.id, slideId]);

  // A new look for the whole box (the inspector): its words are drawn again in it.
  useEffect(() => {
    view.current?.setProps({ markViews: markViews(el) });
  }, [el]);

  return (
    <div
      ref={box}
      data-element={el.id}
      data-editing="true"
      lang={el.lang ? HTML_LANG[el.lang] : undefined}
      style={{
        ...textBoxStyle(el),
        cursor: 'text',
        outline: '2px dashed var(--color-accent)',
        outlineOffset: 2,
      }}
    >
      <div ref={mount} />
    </div>
  );
}
