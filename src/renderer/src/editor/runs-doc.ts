import type { Mark, Node as PMNode } from 'prosemirror-model';
import { Schema } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { Lang, TextElement, TextRun } from '../../../shared/model';
import { detectLang, mainLang, mergeRuns, withDetectedLangs } from '../../../shared/text-runs';
import type { TextPatch } from './ops';
import { patchRun } from './ops';

/*
 * A text box's words in ProseMirror, for editing in place, and back. The
 * document is one block of text, with a hard break for each line break;
 * every piece of text carries one "run" mark holding the run's whole look
 * (everything but its words), so runs come back exactly as they went in:
 * the same looks, the same line breaks, neighbours with the same look
 * joined. Text with no look of its own follows the box.
 */

/** A run's look: everything but its words. */
export type Look = Omit<TextRun, 'text'>;

/** How a piece of text is drawn while it is edited (as the renderer would draw the run). */
export type LookStyle = (look: Look) => Record<string, string>;

/** The schema for one text box: `style` turns a look into the CSS the slide renderer gives a run. */
export function textSchema(style: LookStyle): Schema {
  return new Schema({
    nodes: {
      doc: { content: 'block' },
      block: {
        content: 'inline*',
        toDOM: () => ['div', { 'data-words': '' }, 0],
        parseDOM: [{ tag: 'div' }],
      },
      text: { group: 'inline' },
      hard_break: {
        inline: true,
        group: 'inline',
        selectable: false,
        toDOM: () => ['br'],
        parseDOM: [{ tag: 'br' }],
      },
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

/** A text box's words as a document. */
export function docOf(schema: Schema, el: TextElement): PMNode {
  const runs: TextRun[] = el.runs && el.runs.length > 0 ? el.runs : [{ text: el.text }];
  const content: PMNode[] = [];
  const runMark = schema.marks['run'];
  const hardBreak = schema.nodes['hard_break'];
  const block = schema.nodes['block'];
  const doc = schema.nodes['doc'];
  if (!runMark || !hardBreak || !block || !doc) throw new Error('not a text schema');
  for (const { text, ...look } of runs) {
    const marks = Object.keys(look).length > 0 ? [runMark.create({ look })] : [];
    text.split('\n').forEach((part, i) => {
      if (i > 0) content.push(hardBreak.create(null, null, marks));
      if (part !== '') content.push(schema.text(part, marks));
    });
  }
  return doc.create(null, block.create(null, content));
}

/** The document's words as runs: neighbours with the same look joined, empty ones left out. */
export function runsOf(doc: PMNode): TextRun[] {
  const runs: TextRun[] = [];
  doc.firstChild?.forEach((node) => {
    const text = node.isText ? (node.text ?? '') : node.type.name === 'hard_break' ? '\n' : '';
    if (text === '') return;
    const look = lookOf(node.marks);
    const last = runs.at(-1);
    if (last) {
      const { text: lastText, ...lastLook } = last;
      if (sameLook(lastLook, look)) {
        last.text = lastText + text;
        return;
      }
    }
    runs.push({ text, ...structuredClone(look) });
  });
  return runs;
}

/**
 * A text box with these runs. Runs that only hold words become plain text
 * again; a run without a language gets one from its script.
 * `themeLooks`: for a box made in the editor, how each language looks in
 * the theme (given to words that follow the box).
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
        const { text: words, ...look } = r;
        if (Object.keys(look).length > 0) return r;
        const lang = detectLang(words);
        return lang ? { ...(themeLooks[lang] ?? {}), text: words, lang } : r;
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
  a.text === b.text && JSON.stringify(a.runs ?? null) === JSON.stringify(b.runs ?? null);

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
