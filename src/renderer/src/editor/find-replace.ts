import type { Lang, TextElement, TextRun } from '../../../shared/model';
import type { EditDoc } from '../../../shared/slide-edit';
import { slidesOf } from '../../../shared/slide-edit';
import { detectLang, mergeRuns, scriptOf } from '../../../shared/text-runs';
import { readingOrder } from '../../../shared/tracks';
import { mapElements } from './ops';

/*
 * Find and replace across the presentation (Session 55, Part 17a, the Words group): every text box's words, slide by
 * slide in the presentation's order and box by box as they read (top to bottom, left to right). Words typed in a
 * legacy font are never found (their letters are codes that only look right in that font). Match case and Whole words
 * as a presentation program has them; the words looked for are taken as written (NFC), as the library keeps every
 * word, so a word typed with a combining mark finds the same word written with the composed letter. A whole word's
 * letters, marks and digits are never split (Gujarati and Devanagari vowel signs are marks).
 *
 * Replaced words take the look of the words they replace (the first run's, when a match runs across two); words in
 * another script than those carry their own language, so they are drawn in their own fonts and stand as they should.
 */

export interface FindOptions {
  matchCase: boolean;
  wholeWords: boolean;
}

/** One place the words were found: in a text box on a slide, from `start` to `end` of its words. */
export interface Match {
  slideId: string;
  elementId: string;
  start: number;
  end: number;
}

/** What a word is made of: letters, marks (vowel signs, viramas) and digits. */
const WORDISH = '[\\p{L}\\p{M}\\p{N}]';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** The words looked for, as a pattern; null for nothing to look for. */
function patternOf(query: string, options: FindOptions): RegExp | null {
  const words = query.normalize('NFC');
  if (words.trim() === '') return null;
  const body = escape(words);
  const source = options.wholeWords ? `(?<!${WORDISH})${body}(?!${WORDISH})` : body;
  return new RegExp(source, options.matchCase ? 'gu' : 'giu');
}

/** Where a box's words are typed in a legacy font: from and to, in its words. */
function legacySpans(el: TextElement): [number, number][] {
  const spans: [number, number][] = [];
  let at = 0;
  for (const run of el.runs ?? []) {
    if (run.legacy) spans.push([at, at + run.text.length]);
    at += run.text.length;
  }
  return spans;
}

/** Every match in the presentation, in order. */
export function findMatches(doc: EditDoc, query: string, options: FindOptions): Match[] {
  const pattern = patternOf(query, options);
  if (!pattern) return [];
  const out: Match[] = [];
  for (const slide of slidesOf(doc))
    for (const el of readingOrder(slide.elements)) {
      const legacy = legacySpans(el);
      for (const found of el.text.matchAll(pattern)) {
        const start = found.index;
        const end = start + found[0].length;
        if (end === start) continue;
        if (legacy.some(([a, b]) => start < b && end > a)) continue;
        out.push({ slideId: slide.id, elementId: el.id, start, end });
      }
    }
  return out;
}

/** The text box a match is in, if it is still there. */
function boxOf(doc: EditDoc, match: Match): TextElement | undefined {
  const slide = slidesOf(doc).find((s) => s.id === match.slideId);
  const el = slide?.elements.find((e) => e.id === match.elementId);
  return el?.kind === 'text' ? el : undefined;
}

/** Letters as they are written (a letter with its marks, a conjunct): never cut inside one. */
const LETTERS = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The words round a match on its line, for saying where it is: up to 40 letters each side. */
export function matchContext(doc: EditDoc, match: Match): { before: string; words: string; after: string } {
  const text = boxOf(doc, match)?.text ?? '';
  const lineStart = text.lastIndexOf('\n', match.start - 1) + 1;
  const lineEnd = text.indexOf('\n', match.end);
  const before = [...LETTERS.segment(text.slice(lineStart, match.start))].map((s) => s.segment);
  const after = [...LETTERS.segment(text.slice(match.end, lineEnd < 0 ? text.length : lineEnd))].map(
    (s) => s.segment,
  );
  return {
    before: before.slice(-40).join(''),
    words: text.slice(match.start, match.end),
    after: after.slice(0, 40).join(''),
  };
}

/** Which script a language is written in. */
const SCRIPT: Record<Lang, 'gu' | 'hi' | 'latin'> = {
  gu: 'gu',
  'sa-gu': 'gu',
  hi: 'hi',
  sa: 'hi',
  en: 'latin',
  translit: 'latin',
};

/**
 * A box's words with one stretch replaced: the new words in the look of the run the stretch starts in, in their own
 * language when they are in another script than the words they go among.
 */
function replaceIn(el: TextElement, start: number, end: number, words: string): TextElement {
  const runs: TextRun[] = el.runs && el.runs.length > 0 ? el.runs : [{ text: el.text }];
  const out: TextRun[] = [];
  let at = 0;
  let placed = false;
  for (const run of runs) {
    const from = at;
    const to = at + run.text.length;
    at = to;
    // Wholly before or after the stretch (one that starts where this run ends goes in the next).
    if (to <= start || from >= end) {
      out.push(run);
      continue;
    }
    const head = run.text.slice(0, Math.max(0, start - from));
    const tail = run.text.slice(Math.min(run.text.length, end - from));
    if (head) out.push({ ...run, text: head });
    if (!placed) {
      placed = true;
      out.push(...withWords(run, el, words));
    }
    if (tail) out.push({ ...run, text: tail });
  }
  const merged = mergeRuns(out);
  const text = merged.map((r) => r.text).join('');
  const { runs: _old, ...rest } = el;
  const styled = merged.some((r) => Object.keys(r).some((k) => k !== 'text'));
  return styled ? { ...rest, text, runs: merged } : { ...rest, text };
}

/** The new words as a run in `run`'s look, carrying their own language when their script is another. */
function withWords(run: TextRun, el: TextElement, words: string): TextRun[] {
  if (words === '') return [];
  const { text: _text, ...look } = run;
  const lang = look.lang !== undefined ? look.lang : el.lang;
  const script = scriptOf(words);
  if (script && (!lang || SCRIPT[lang] !== script)) {
    const own = detectLang(words);
    if (own && own !== lang) return [{ ...look, text: words, lang: own }];
  }
  return [{ ...look, text: words }];
}

/** The presentation with these matches' words replaced, one step for Undo; boxes and slides without one unchanged. */
export function replaceMatches(doc: EditDoc, matches: readonly Match[], replacement: string): EditDoc {
  const words = replacement.normalize('NFC');
  // Box by box, from the last match to the first, so each match's place is still right when it is replaced.
  const byBox = new Map<string, Match[]>();
  for (const m of matches) {
    const key = `${m.slideId}\u0000${m.elementId}`;
    byBox.set(key, [...(byBox.get(key) ?? []), m]);
  }
  let next = doc;
  for (const list of byBox.values()) {
    const first = list[0];
    if (!first) continue;
    const ordered = [...list].sort((a, b) => b.start - a.start);
    next = mapElements(next, first.slideId, [first.elementId], (el) => {
      if (el.kind !== 'text') return el;
      let box = el;
      for (const m of ordered) if (m.end <= box.text.length) box = replaceIn(box, m.start, m.end, words);
      return box;
    });
  }
  return next;
}
