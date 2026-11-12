import type { Mark, Node as PMNode, NodeType } from 'prosemirror-model';
import { Schema } from 'prosemirror-model';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { Lang, ListMark, TextElement, TextParagraph, TextRun } from '../../../shared/model';
import { clampLevel } from '../../../shared/text-lists';
import { detectLang, mainLang, mergeRuns, withDetectedLangs } from '../../../shared/text-runs';
import type { BoxPatch, TextPatch } from './ops';
import { patchRun } from './ops';

/*
 * A text box's words in ProseMirror, for editing in place, and back. The document is the box's lines, one block
 * each (Session 55, Part 17a: until then one block with a hard break for each line break): a line knows whether it is
 * one of a list (its mark and level: bullets and numbering) and the look of the line break that ends it. Every piece
 * of text carries one "run" mark holding the run's whole look but its line's list, so runs come back exactly as they
 * went in: the same looks, the same line breaks with the looks they had, neighbours with the same look joined, every
 * run of a list's line carrying its mark. Text with no look of its own follows the box.
 */

/** A run's look: everything but its words. */
export type Look = Omit<TextRun, 'text'>;

/** How a piece of text is drawn while it is edited (as the renderer would draw the run). */
export type LookStyle = (look: Look) => Record<string, string>;

/** A line of the document: its list (a mark and a level, or none) and the look of the line break ending it. */
export interface LineAttrs {
  list: ListMark | null;
  level: number;
  /** Source paragraph formatting survives replacing the words and their run marks. */
  paragraph: TextParagraph | null;
  /** The look of the line break at its end (null: none of its own, or the last line). */
  brk: Look | null;
}

/** The schema for one text box: `style` turns a look into the CSS the slide renderer gives a run. */
export function textSchema(style: LookStyle): Schema {
  return new Schema({
    nodes: {
      doc: { content: 'line+' },
      line: {
        content: 'inline*',
        attrs: {
          list: { default: null },
          level: { default: 0 },
          paragraph: { default: null },
          brk: { default: null },
        },
        toDOM: (node) => {
          const attrs = node.attrs as LineAttrs;
          return ['div', { 'data-words': '', ...(attrs.list ? { 'data-list': attrs.list } : {}) }, 0];
        },
        parseDOM: [{ tag: 'div' }],
      },
      text: { group: 'inline' },
    },
    marks: {
      run: {
        attrs: { look: { default: {} } },
        toDOM: (mark) => {
          const look = mark.attrs['look'] as Look;
          const css = Object.entries(style(look))
            .map(([k, v]) => `${k}: ${v}`)
            .join('; ');
          return [
            'span',
            {
              style: css,
              ...(look.lang ? { 'data-lang': look.lang } : {}),
              ...(look.legacy ? { 'data-legacy': 'true' } : {}),
            },
            0,
          ];
        },
      },
    },
  });
}

/** The look a piece of text carries ({} when it follows the box). */
export const lookOf = (marks: readonly Mark[]): Look =>
  (marks.find((m) => m.type.name === 'run')?.attrs['look'] as Look | undefined) ?? {};

const sameLook = (a: Look, b: Look) => {
  const ka = Object.keys(a).filter((k) => a[k as keyof Look] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k as keyof Look] !== undefined);
  return (
    ka.length === kb.length &&
    ka.every((k) => JSON.stringify(a[k as keyof Look]) === JSON.stringify(b[k as keyof Look]))
  );
};

/** Text and break marks keep their own look while the line holds the paragraph formatting. */
const withoutLineFormat = (look: Look): Look => {
  const { list: _list, level: _level, paragraph: _paragraph, ...rest } = look;
  return rest;
};

/** A line's list as its runs carry it: its mark, and its level when it is further in. */
const listLook = (attrs: LineAttrs): Look =>
  attrs.list ? { list: attrs.list, ...(attrs.level > 0 ? { level: attrs.level } : {}) } : {};

/** The document's line type. */
const lineOf = (schema: Schema): NodeType => {
  const line = schema.nodes['line'];
  if (!line) throw new Error('not a text schema');
  return line;
};

/** A text box's words as a document. */
export function docOf(schema: Schema, el: TextElement): PMNode {
  const runs: TextRun[] = el.runs && el.runs.length > 0 ? el.runs : [{ text: el.text }];
  const runMark = schema.marks['run'];
  const doc = schema.nodes['doc'];
  const line = lineOf(schema);
  if (!runMark || !doc) throw new Error('not a text schema');
  const lines: { pieces: { text: string; look: Look }[]; brk: Look | null }[] = [{ pieces: [], brk: null }];
  for (const { text, ...look } of runs) {
    text.split('\n').forEach((part, i) => {
      if (i > 0) {
        const ended = lines[lines.length - 1];
        if (ended) ended.brk = look;
        lines.push({ pieces: [], brk: null });
      }
      if (part !== '') lines[lines.length - 1]?.pieces.push({ text: part, look });
    });
  }
  return doc.create(
    null,
    lines.map((l) => {
      // The line's list: its first words say, else its line break (a blank line of a list).
      const source = l.pieces.find((p) => p.text.trim() !== '')?.look ?? l.pieces[0]?.look ?? l.brk ?? {};
      const list = source.list ?? null;
      const attrs: LineAttrs = {
        list,
        level: list ? clampLevel(source.level) : 0,
        paragraph: source.paragraph ?? null,
        brk: l.brk ? withoutLineFormat(l.brk) : null,
      };
      const content = l.pieces.map((p) => {
        const look = withoutLineFormat(p.look);
        return schema.text(p.text, Object.keys(look).length > 0 ? [runMark.create({ look })] : []);
      });
      return line.create(attrs, content);
    }),
  );
}

/** The document's words as runs: neighbours with the same look joined, empty ones left out. */
export function runsOf(doc: PMNode): TextRun[] {
  const runs: TextRun[] = [];
  const push = (text: string, look: Look) => {
    if (text === '') return;
    const last = runs.at(-1);
    if (last) {
      const { text: lastText, ...lastLook } = last;
      if (sameLook(lastLook, look)) {
        last.text = lastText + text;
        return;
      }
    }
    runs.push({ text, ...structuredClone(look) });
  };
  doc.forEach((line, _offset, index) => {
    const attrs = line.attrs as LineAttrs;
    const list = listLook(attrs);
    const paragraph = attrs.paragraph ? { paragraph: attrs.paragraph } : {};
    line.forEach((node) => {
      if (node.isText) push(node.text ?? '', { ...lookOf(node.marks), ...paragraph, ...list });
    });
    if (index < doc.childCount - 1) push('\n', { ...(attrs.brk ?? {}), ...paragraph, ...list });
  });
  return runs;
}

function formatParagraph(paragraph: TextParagraph, { align, lineHeight }: BoxPatch): TextParagraph {
  const aligned = align === undefined ? paragraph : { ...paragraph, align };
  if (lineHeight === undefined) return aligned;
  const { lineHeightPx: _fixed, ...rest } = aligned;
  return { ...rest, lineHeight };
}

/** A whole-box alignment or spacing change also updates the source paragraph overrides. */
export function formatTextBox(element: TextElement, patch: BoxPatch): TextElement {
  const next = { ...element, style: { ...element.style, ...patch } };
  if (element.runs && (patch.align !== undefined || patch.lineHeight !== undefined))
    next.runs = element.runs.map((run) =>
      run.paragraph ? { ...run, paragraph: formatParagraph(run.paragraph, patch) } : run,
    );
  return next;
}

/** Keep the draft in step with the same whole-box change recorded by the editor's Undo. */
export function formatEditedParagraphs(state: EditorState, patch: BoxPatch): Transaction {
  const tr = state.tr.setMeta('addToHistory', false);
  if (patch.align === undefined && patch.lineHeight === undefined) return tr;
  state.doc.forEach((line, at) => {
    const attrs = line.attrs as LineAttrs;
    if (attrs.paragraph)
      tr.setNodeMarkup(at, undefined, { ...attrs, paragraph: formatParagraph(attrs.paragraph, patch) });
  });
  return tr;
}

/**
 * A text box with these runs. Runs that only hold words become plain text
 * again; a run without a language gets one from its script.
 * `themeLooks`: for a box made in the editor, how each language looks in
 * the theme (given to words that follow the box; a list's mark is not a look of their own).
 */
export function withRuns(
  el: TextElement,
  runs: readonly TextRun[],
  themeLooks?: Partial<Record<Lang, Omit<TextRun, 'text' | 'lang' | 'legacy'>>>,
): TextElement {
  const text = runs.map((r) => r.text).join('');
  const { runs: _old, ...rest } = el;
  const plain = runs.every((r) => Object.keys(r).length === 1);
  if (plain && !themeLooks) return { ...rest, text, lang: el.lang ?? detectLang(text) };
  let next: TextRun[];
  if (themeLooks) {
    // A box made here: each line that follows the box takes its language's look from the theme.
    next = mergeRuns(
      linesOf(runs).map((r) => {
        const { text: words, list, level, ...look } = r;
        if (Object.keys(look).length > 0) return r;
        const lang = detectLang(words);
        const listed = list ? { list, ...(level !== undefined ? { level } : {}) } : {};
        return lang ? { ...(themeLooks[lang] ?? {}), text: words, lang, ...listed } : r;
      }),
    );
  } else next = withDetectedLangs(runs);
  const styled = next.some((r) => Object.keys(r).some((k) => k !== 'text'));
  return styled
    ? { ...rest, text, runs: next, lang: el.lang ?? mainLang(next) }
    : { ...rest, text, lang: el.lang ?? detectLang(text) };
}

/** Runs cut at line ends (each keeps its line break), so each line can have its own look. */
function linesOf(runs: readonly TextRun[]): TextRun[] {
  return runs.flatMap((r) => {
    const parts = r.text.split('\n');
    return parts.map((part, i) => ({ ...r, text: i < parts.length - 1 ? `${part}\n` : part }));
  });
}

/** Whether two text boxes have the same words and looks. */
export const sameWords = (a: TextElement, b: TextElement): boolean =>
  a.text === b.text && canonical(a.runs ?? null) === canonical(b.runs ?? null);

/** Data as words, its objects' keys in order (Session 55, Part 17a): settings written in another order are the same. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : v,
  );
}

/**
 * A transaction giving the selected words a new look. With nothing selected
 * it sets the look of what is typed next.
 */
export function restyle(state: EditorState, patch: TextPatch): Transaction {
  const runMark = state.schema.marks['run'];
  if (!runMark) return state.tr;
  const { from, to, empty, $from } = state.selection;
  const tr = state.tr;
  const markFor = (look: Look) => {
    const patched = patchRun({ text: '', ...look }, patch);
    const { text: _t, ...rest } = patched;
    return runMark.create({ look: rest });
  };
  if (empty) {
    const marks = state.storedMarks ?? $from.marks();
    return tr.setStoredMarks([markFor(lookOf(marks))]);
  }
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return true;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    if (start < end) tr.addMark(start, end, markFor(lookOf(node.marks)));
    return false;
  });
  return tr;
}

/** A transaction giving every word in the box a change of look (the whole box, while typing in it). */
export function restyleAll(state: EditorState, patch: TextPatch): Transaction {
  const runMark = state.schema.marks['run'];
  const tr = state.tr;
  if (!runMark) return tr;
  state.doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    const look = lookOf(node.marks);
    const patched = patchRun({ text: '', ...look }, patch);
    const { text: _t, ...rest } = patched;
    if (Object.keys(rest).length > 0) tr.addMark(pos, pos + node.nodeSize, runMark.create({ look: rest }));
    else tr.removeMark(pos, pos + node.nodeSize, runMark);
    return false;
  });
  return tr;
}

/** The look of the selected words (the first piece), or of what is typed next. */
export function selectedLook(state: EditorState): Look {
  const { from, to, empty, $from } = state.selection;
  if (empty) return lookOf(state.storedMarks ?? $from.marks());
  const looks: Look[] = [];
  state.doc.nodesBetween(from, to, (node) => {
    if (looks.length === 0 && node.isInline) looks.push(lookOf(node.marks));
    return looks.length === 0;
  });
  return looks[0] ?? {};
}

/**
 * ⌘B, ⌘I and ⌘U while typing (Session 55, Part 17a): the selected words (or what is typed next) bold, italic or
 * underlined, or struck through, and back. Bold off is the box's weight when that is not bold (the words follow the
 * box), else regular.
 */
export function toggleWords(
  which: 'bold' | 'italic' | 'underline' | 'strike',
  boxWeight: () => number,
): Command {
  return (state, dispatch) => {
    const look = selectedLook(state);
    const box = boxWeight();
    const patch: TextPatch =
      which === 'bold'
        ? { weight: (look.weight ?? box) >= 650 ? (box < 650 ? undefined : 400) : 700 }
        : which === 'italic'
          ? { italic: look.italic ? undefined : true }
          : which === 'underline'
            ? { underline: look.underline ? undefined : true }
            : { strike: look.strike ? undefined : true };
    dispatch?.(restyle(state, patch));
    return true;
  };
}

// ---- lists, line by line (Session 55, Part 17a) ------------------------------------------------

/** Each line the selection touches: where it starts, and its attrs. */
function linesTouched(state: EditorState): { pos: number; attrs: LineAttrs }[] {
  const { from, to } = state.selection;
  const out: { pos: number; attrs: LineAttrs }[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'line') out.push({ pos, attrs: node.attrs as LineAttrs });
    return false;
  });
  return out;
}

/** The list the selection's first line is in (the Words group's Bullets and Numbering say so). */
export function selectedList(state: EditorState): { mark: ListMark | null; level: number } {
  const attrs = state.selection.$from.parent.attrs as Partial<LineAttrs>;
  return { mark: attrs.list ?? null, level: attrs.list ? (attrs.level ?? 0) : 0 };
}

/**
 * A transaction making the lines the selection touches one of a list with this mark (their level kept, unless one is
 * given), or taking them out of their list (null).
 */
export function listLines(state: EditorState, list: { mark: ListMark; level?: number } | null): Transaction {
  const tr = state.tr;
  for (const { pos, attrs } of linesTouched(state)) {
    const next: LineAttrs = list
      ? { ...attrs, list: list.mark, level: clampLevel(list.level ?? attrs.level) }
      : { ...attrs, list: null, level: 0 };
    tr.setNodeMarkup(pos, undefined, next);
  }
  return tr;
}

/** The marks at the caret: what is typed next carries them, and so does a line break made there. */
const marksAt = (state: EditorState) => state.storedMarks ?? state.selection.$from.marks();

/** A look for a line break: null for one with no look of its own. */
const brkLook = (marks: readonly Mark[]): Look | null => {
  const look = lookOf(marks);
  return Object.keys(look).length > 0 ? structuredClone(look) : null;
};

/** Cut the line at `pos` in two (in a transaction): the new line goes on with its list, the break in `brk`'s look. */
function cutLine(tr: Transaction, pos: number, brk: Look | null): void {
  const $pos = tr.doc.resolve(pos);
  const attrs = $pos.parent.attrs as LineAttrs;
  const start = $pos.before();
  let next = attrs;
  if (attrs.paragraph?.startAt !== undefined) {
    const { startAt: _startAt, ...paragraph } = attrs.paragraph;
    next = { ...attrs, paragraph };
  }
  tr.split(pos, 1, [{ type: $pos.parent.type, attrs: next }]);
  tr.setNodeMarkup(start, undefined, { ...attrs, brk });
}

/**
 * Enter (and Shift+Enter): a new line, a list going on into it; on an empty line of a list, the line leaves the list
 * instead (as a presentation program does).
 */
export const splitLine: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const line = $from.parent;
  if (line.type.name !== 'line') return false;
  const attrs = line.attrs as LineAttrs;
  if (empty && attrs.list && line.content.size === 0) {
    dispatch?.(state.tr.setNodeMarkup($from.before(), undefined, { ...attrs, list: null, level: 0 }));
    return true;
  }
  if (dispatch) {
    const marks = marksAt(state);
    const tr = state.tr.deleteSelection();
    cutLine(tr, tr.selection.from, brkLook(marks));
    tr.setStoredMarks(marks);
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Backspace at the very start of a list's line: the line leaves its list first (a second Backspace joins it up). */
export const unlistAtStart: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const attrs = $from.parent.attrs as Partial<LineAttrs>;
  if (!empty || $from.parentOffset !== 0 || !attrs.list) return false;
  dispatch?.(state.tr.setNodeMarkup($from.before(), undefined, { ...attrs, list: null, level: 0 }));
  return true;
};

/** Change the level of the list's lines the selection touches; false when none of them is a list's. */
function shiftLevel(by: 1 | -1): Command {
  return (state, dispatch) => {
    const lines = linesTouched(state).filter((l) => l.attrs.list !== null);
    const moving = lines.filter((l) => clampLevel(l.attrs.level + by) !== l.attrs.level);
    if (lines.length === 0) return false;
    if (dispatch && moving.length > 0) {
      const tr = state.tr;
      for (const { pos, attrs } of moving)
        tr.setNodeMarkup(pos, undefined, { ...attrs, level: clampLevel(attrs.level + by) });
      dispatch(tr);
    }
    return moving.length > 0;
  };
}

/** Tab on a list's line: further in. Shift+Tab: back out. */
export const indentLine: Command = shiftLevel(1);
export const outdentLine: Command = shiftLevel(-1);

/**
 * Words pasted at the caret as plain text, their lines as lines (a list going on through them), in the look at the
 * caret.
 */
export function pasteText(state: EditorState, text: string): Transaction {
  const marks = marksAt(state);
  const tr = state.tr.deleteSelection();
  text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .forEach((part, i) => {
      if (i > 0) cutLine(tr, tr.selection.from, brkLook(marks));
      if (part !== '') tr.insert(tr.selection.from, state.schema.text(part, marks));
    });
  return tr.scrollIntoView();
}

/**
 * Join a line with the one before it (Backspace at its start), or the next with it (Delete at its end): the line
 * keeps its list, and takes the line break of the line it took in.
 */
export const joinLineUp: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0 || $from.parent.type.name !== 'line') return false;
  const index = $from.index(0);
  if (index === 0) return false;
  const before = state.doc.child(index - 1);
  const start = $from.before();
  if (dispatch) {
    const brk = ($from.parent.attrs as LineAttrs).brk;
    const tr = state.tr.join(start);
    const joined = start - before.nodeSize;
    tr.setNodeMarkup(joined, undefined, { ...(before.attrs as LineAttrs), brk });
    dispatch(tr.scrollIntoView());
  }
  return true;
};

export const joinLineDown: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type.name !== 'line' || $from.parentOffset !== $from.parent.content.size)
    return false;
  const index = $from.index(0);
  if (index >= state.doc.childCount - 1) return false;
  const after = state.doc.child(index + 1);
  const start = $from.before();
  if (dispatch) {
    const tr = state.tr.join($from.after());
    tr.setNodeMarkup(start, undefined, {
      ...($from.parent.attrs as LineAttrs),
      brk: (after.attrs as LineAttrs).brk,
    });
    dispatch(tr.scrollIntoView());
  }
  return true;
};
