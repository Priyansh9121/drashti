import { baseKeymap, chainCommands } from 'prosemirror-commands';
import { history, redo, redoDepth, undo, undoDepth } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { EditorState, Plugin, TextSelection } from 'prosemirror-state';
import type { MarkViewConstructor } from 'prosemirror-view';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import type { CSSProperties } from 'react';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TextElement, TextRun } from '../../../shared/model';
import { lineMarks } from '../../../shared/text-lists';
import { htmlLang, TranslitSourceContext } from '../render/lang';
import type { TranslitSource } from '../../../shared/model';
import {
  listLineStyle,
  listMarkerBoxStyle,
  listMarkerStyle,
  runStyle,
  textBoxStyle,
  useShrinkToFit,
} from '../render/SlideView';
import {
  allowSourceContent,
  commit,
  currentLook,
  redo as redoStep,
  revokeSourceContent,
  stopEditing,
  undo as undoStep,
  useEditor,
} from './editor-store';
import { deleteElements, findSlide, mapElements } from './ops';
import type { LineAttrs, Look } from './runs-doc';
import {
  docOf,
  indentLine,
  joinLineDown,
  joinLineUp,
  lookOf,
  outdentLine,
  pasteText,
  runsOf,
  sameWords,
  splitLine,
  textSchema,
  toggleWords,
  unlistAtStart,
  withRuns,
} from './runs-doc';

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

/**
 * Undo, from the editor's button, the keys or the menu (Session 55, Part 17a: every change, typing too): while typing,
 * the typing's last step, the keyboard staying in the box; with no typing left to undo, the typing ends and the
 * editor's last change goes.
 */
export function undoAny(): void {
  const typing = useEditor.getState().editing !== null ? active : null;
  if (typing && Number(undoDepth(typing.view.state)) > 0) {
    undo(typing.view.state, typing.view.dispatch);
    typing.view.focus();
    return;
  }
  if (typing) finishTextEditing();
  undoStep();
}

/** Redo, as Undo: the typing's last undone step while typing, else the editor's (once typing has ended). */
export function redoAny(): void {
  const typing = useEditor.getState().editing !== null ? active : null;
  if (typing && Number(redoDepth(typing.view.state)) > 0) {
    redo(typing.view.state, typing.view.dispatch);
    typing.view.focus();
    return;
  }
  if (useEditor.getState().future.length === 0) return;
  if (typing) finishTextEditing();
  redoStep();
}

/** Run something once the key that asked for it is done with (a command must not end the editor it runs in). */
function later(run: () => void): boolean {
  queueMicrotask(run);
  return true;
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
function markViews(el: TextElement, source: TranslitSource | null): Record<string, MarkViewConstructor> {
  return {
    run: (mark: Mark) => {
      const look = mark.attrs['look'] as Look;
      const dom = document.createElement('span');
      dom.setAttribute('style', cssText(runStyle(look, el)));
      const lang = look.lang ?? el.lang;
      if (lang) dom.setAttribute('lang', htmlLang(lang, source));
      if (look.lang) dom.dataset['lang'] = look.lang;
      if (look.legacy) dom.dataset['legacy'] = 'true';
      return { dom };
    },
  };
}

/**
 * A list's lines as the screens draw them (Session 55, Part 17a: render/SlideView.tsx's ListedRuns): each in by its
 * level, its mark in the room before its words, numbers counted as the screens count them. A blank line of a list is
 * in by its level (the caret sits where its words will be) and shows no mark, as on the screens.
 */
function listDecorations(doc: PMNode, el: TextElement): DecorationSet {
  const lines: { node: PMNode; at: number }[] = [];
  doc.forEach((node, at) => {
    lines.push({ node, at });
  });
  const looks = lines.map(({ node }) => {
    const attrs = node.attrs as LineAttrs;
    const runs: TextRun[] = [];
    node.forEach((text) => {
      if (text.isText)
        runs.push({
          text: text.text ?? '',
          ...lookOf(text.marks),
          ...(attrs.list ? { list: attrs.list, ...(attrs.level > 0 ? { level: attrs.level } : {}) } : {}),
        });
    });
    return runs;
  });
  const marks = lineMarks(looks);
  const decorations: Decoration[] = [];
  lines.forEach(({ node, at }, i) => {
    const attrs = node.attrs as LineAttrs;
    if (!attrs.list) return;
    const first: Omit<TextRun, 'text'> = looks[i]?.[0] ?? attrs.brk ?? {};
    const size = first.size ?? el.style.fontSize;
    const drawn = marks[i];
    const mark = drawn?.mark ?? null;
    // A blank line of the list: in as far as its words will be.
    const line = mark === null ? { mark: attrs.list, level: attrs.level, label: null } : (drawn ?? null);
    if (!line) return;
    decorations.push(Decoration.node(at, at + node.nodeSize, { style: cssText(listLineStyle(line, size)) }));
    if (mark === null) return;
    const label = drawn?.label ?? null;
    decorations.push(
      Decoration.widget(
        at + 1,
        () => {
          const dom = document.createElement('span');
          dom.setAttribute('aria-hidden', 'true');
          dom.setAttribute('contenteditable', 'false');
          dom.dataset['listMarker'] = mark;
          dom.setAttribute('style', cssText(listMarkerBoxStyle({ mark, label }, first, el)));
          if (label !== null) dom.textContent = label;
          else {
            const shape = document.createElement('span');
            shape.setAttribute('style', cssText(listMarkerStyle(mark, first)));
            dom.append(shape);
          }
          return dom;
        },
        {
          side: -1,
          key: `${String(i)}:${mark}:${String(label)}:${String(size)}:${String(first.color)}`,
          ignoreSelection: true,
        },
      ),
    );
  });
  return DecorationSet.create(doc, decorations);
}

/** The words as the document should have them now; an emptied box made here goes away. */
function commitWords(view: EditorView, elementId: string, slideId: string): void {
  const s = useEditor.getState();
  if (!s.doc) return;
  const el = findSlide(s.doc, slideId)?.elements.find((e) => e.id === elementId);
  if (el?.kind !== 'text') return;
  const made = s.made.includes(elementId);
  const next = withRuns(el, runsOf(view.state.doc), made ? (currentLook()?.langs ?? {}) : undefined);
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
  // The box as it is now (its size and look size a list's marks).
  const boxNow = useRef(el);
  useLayoutEffect(() => {
    boxNow.current = el;
  });
  const [typed, setTyped] = useState(0);
  // What the slide's transliteration is of, for its words' lang (Sessions 31–36, I18N-4).
  const source = useContext(TranslitSourceContext);
  useShrinkToFit(box, mount, el, typed);

  // One editor per box being typed in.
  useEffect(() => {
    const root = mount.current;
    if (!root) return;
    const schema = textSchema(() => ({}));
    // Bullets and numbering drawn as the screens draw them (Session 55, Part 17a), from the box as it is now.
    const lists = new Plugin({
      props: {
        decorations: (state) => listDecorations(state.doc, boxNow.current),
      },
    });
    const pm = new EditorView(
      { mount: root },
      {
        state: EditorState.create({
          doc: docOf(schema, el),
          plugins: [
            history(),
            keymap({
              // The typing's own steps; past its first, the editor's (the typing ends first).
              'Mod-z': (state, dispatch) => undo(state, dispatch) || later(undoAny),
              'Mod-y': (state, dispatch) => redo(state, dispatch) || later(redoAny),
              'Shift-Mod-z': (state, dispatch) => redo(state, dispatch) || later(redoAny),
              // A new line (a list going on into it); Backspace and Delete join lines, a list's mark going first.
              Enter: splitLine,
              'Shift-Enter': splitLine,
              Backspace: chainCommands(unlistAtStart, joinLineUp),
              Delete: joinLineDown,
              // A list's line further in, and back out (Session 55, Part 17a); elsewhere Tab is as it was.
              Tab: indentLine,
              'Shift-Tab': outdentLine,
              // The words selected (or what is typed next) bold, italic, underlined, and back.
              'Mod-b': toggleWords('bold', () => boxNow.current.style.fontWeight),
              'Mod-i': toggleWords('italic', () => boxNow.current.style.fontWeight),
              'Mod-u': toggleWords('underline', () => boxNow.current.style.fontWeight),
            }),
            keymap(baseKeymap),
            lists,
          ],
        }),
        markViews: markViews(el, source),
        attributes: {
          'data-testid': 'text-editing',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': 'Words of the text box',
          spellcheck: 'false',
          style: 'width: 100%; flex-shrink: 0; outline: none; caret-color: currentColor',
        },
        dispatchTransaction(tr) {
          if (tr.docChanged) {
            const before = pm.state;
            if (
              !allowSourceContent(slideId, () => {
                if (pm.isDestroyed) return;
                // Moving focus to the notice can update the selection. Keep the
                // proposed words without applying a transaction from stale state.
                pm.dispatch(
                  pm.state === before
                    ? tr
                    : pm.state.tr.replaceWith(0, pm.state.doc.content.size, tr.doc.content),
                );
              })
            )
              return;
          }
          pm.updateState(pm.state.apply(tr));
          setTyped((n) => n + 1);
          // How far the typing's own Undo and Redo go (the editor's buttons offer them: Session 55, Part 17a).
          const typing = { undo: Number(undoDepth(pm.state)), redo: Number(redoDepth(pm.state)) };
          useEditor.setState((s) => ({ textTick: s.textTick + 1, typing }));
          const doc = useEditor.getState().doc;
          const slide = doc ? findSlide(doc, slideId) : undefined;
          if (
            tr.docChanged &&
            typing.undo === 0 &&
            slide?.deck &&
            slide.documentPage &&
            !slide.documentPage.edited &&
            sameWords(withRuns(el, runsOf(pm.state.doc)), el)
          ) {
            revokeSourceContent(slideId);
            queueMicrotask(() => {
              if (active?.view === pm) finishTextEditing();
            });
          }
        },
        // Pasted text arrives as plain text, its lines as lines (a list going on through them), in the look at the caret.
        handlePaste(v, event) {
          const text = event.clipboardData?.getData('text/plain') ?? '';
          v.dispatch(pasteText(v.state, text));
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
    view.current?.setProps({ markViews: markViews(el, source) });
  }, [el, source]);

  return (
    <div
      ref={box}
      data-element={el.id}
      data-editing="true"
      lang={el.lang ? htmlLang(el.lang, source) : undefined}
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
