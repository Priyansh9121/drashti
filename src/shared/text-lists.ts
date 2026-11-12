import type { ListMark, NumberMark, TextElement, TextRun } from './model';
import { isNumberMark, MAX_LIST_LEVEL } from './model';
import { boxLines } from './tracks';

/*
 * Bullets and numbering (Session 55, Part 17a), line by line as a presentation program has them. A line of a text box
 * is one of a list when its runs say so: every run of the line carries its mark (`list`) and, further in, its level
 * (`level`, 1 to 4; left out for the first). Kept on the runs, a line's mark goes wherever the line goes: the kirtan's
 * language view moves whole lines (language-view.ts), and so does everything else that reads a box line by line.
 *
 * A number counts its list's lines at its level: a blank line takes none and breaks nothing; a deeper line leaves its
 * level's count as it is, and a line back out starts the deeper count again; a bullet at the level, or a line with
 * words outside any list, starts it again. Numbers are written in the way the mark says: 1. 2. 3., in Gujarati or
 * Devanagari digits, a. b. c., A. B. C. or i. ii. iii.
 */

/** A line's list: its mark (null: not one of a list) and its level (0 the first). */
export interface LineList {
  mark: ListMark | null;
  level: number;
}

/** A line's mark as drawn: its list, and a number's label (null for a bullet, or a line not in a list). */
export interface LineMark extends LineList {
  label: string | null;
}

const GUJARATI_DIGITS = '૦૧૨૩૪૫૬૭૮૯';
const DEVANAGARI_DIGITS = '०१२३४५६७८९';

const ROMAN: readonly [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

/** n in small Roman numerals (n at least 1). */
function roman(n: number): string {
  let out = '';
  let left = n;
  for (const [value, letters] of ROMAN)
    while (left >= value) {
      out += letters;
      left -= value;
    }
  return out;
}

/** n as letters: a to z, then aa, ab… (n at least 1). */
function letters(n: number): string {
  let out = '';
  let left = n;
  while (left > 0) {
    const r = (left - 1) % 26;
    out = String.fromCharCode(97 + r) + out;
    left = Math.floor((left - 1) / 26);
  }
  return out;
}

/** A number's label in a way of numbering: "3.", "૩.", "३.", "c.", "C.", "iii.". */
export function listLabel(n: number, mark: NumberMark): string {
  const digits = String(Math.max(1, Math.floor(n)));
  switch (mark) {
    case '1':
      return `${digits}.`;
    case 'gu':
      return `${digits.replace(/\d/gu, (d) => GUJARATI_DIGITS[Number(d)] ?? d)}.`;
    case 'hi':
      return `${digits.replace(/\d/gu, (d) => DEVANAGARI_DIGITS[Number(d)] ?? d)}.`;
    case 'a':
      return `${letters(Number(digits))}.`;
    case 'A':
      return `${letters(Number(digits)).toUpperCase()}.`;
    case 'i':
      return `${roman(Number(digits))}.`;
    case 'I':
      return `${roman(Number(digits)).toUpperCase()}.`;
  }
}

/** A level within reach: 0 to MAX_LIST_LEVEL, whole. */
export const clampLevel = (level: number | undefined): number =>
  Math.max(0, Math.min(MAX_LIST_LEVEL, Math.round(level ?? 0)));

/** A line's list, from its runs: the first with words says (else the first). */
export function lineListOf(runs: readonly TextRun[]): LineList {
  const run = runs.find((r) => r.text.trim() !== '') ?? runs[0];
  if (!run?.list) return { mark: null, level: 0 };
  return { mark: run.list, level: clampLevel(run.level) };
}

/** Each line's mark, numbers counted (the runs of each line, as boxLines gives them). */
export function lineMarks(lines: readonly (readonly TextRun[])[]): LineMark[] {
  /** Per level: the numbering going on there, and its count. */
  const counts: ({ mark: NumberMark; n: number; startAt: number | undefined } | null)[] = [];
  return lines.map((runs) => {
    const blank = runs.every((r) => r.text.trim() === '');
    if (blank) return { mark: null, level: 0, label: null };
    const { mark, level } = lineListOf(runs);
    if (mark === null) {
      counts.length = 0;
      return { mark: null, level: 0, label: null };
    }
    // Deeper counts start again under this line.
    counts.length = Math.min(counts.length, level + 1);
    if (!isNumberMark(mark)) {
      counts[level] = null;
      return { mark, level, label: null };
    }
    const was = counts[level];
    const first = runs.find((run) => run.text.trim() !== '');
    const startAt = first?.paragraph?.startAt;
    const continuing = was?.mark === mark && (startAt === undefined || startAt === was.startAt);
    const n = continuing ? was.n + 1 : (startAt ?? 1);
    counts[level] = { mark, n, startAt: continuing ? was.startAt : startAt };
    return { mark, level, label: listLabel(n, mark) };
  });
}

/** Each line of a text box's words, with its mark. */
export function boxLineMarks(el: Pick<TextElement, 'text' | 'lang' | 'runs'>): LineMark[] {
  return lineMarks(boxLines(el).map((l) => l.runs));
}

/** Whether any line of a box is one of a list (it is drawn line by line then). */
export function hasList(el: Pick<TextElement, 'runs'>): boolean {
  return el.runs?.some((r) => r.list !== undefined) ?? false;
}

/** A run with its line's list (or none). */
function listed(run: TextRun, list: { mark: ListMark; level?: number } | null): TextRun {
  const { list: _mark, level: _level, ...rest } = run;
  if (!list) return rest;
  const level = clampLevel(list.level);
  return { ...rest, list: list.mark, ...(level > 0 ? { level } : {}) };
}

/**
 * The text box with some of its lines (by number, or all) made one of a list with this mark and level, or taken out
 * of their list (null). Its words and their looks stay as they are; a box of plain words gets a run to carry it.
 */
export function withLinesListed(
  el: TextElement,
  which: readonly number[] | 'all',
  list: { mark: ListMark; level?: number } | null,
): TextElement {
  const chosen = (i: number) => which === 'all' || which.includes(i);
  if (!el.runs || el.runs.length === 0) {
    // Plain words: one run per line, so each line can carry its own mark.
    if (list === null) return el;
    const runs: TextRun[] = [];
    const texts = el.text.split('\n');
    texts.forEach((text, i) => {
      const end = i < texts.length - 1 ? '\n' : '';
      if (text + end === '') return;
      runs.push(chosen(i) ? listed({ text: text + end }, list) : { text: text + end });
    });
    return withMerged(el, runs);
  }
  // The line break at a line's end goes with that line: each line's runs, its break with its last run.
  const runs: TextRun[] = [];
  let line = 0;
  for (const run of el.runs) {
    const parts = run.text.split('\n');
    parts.forEach((part, i) => {
      const end = i < parts.length - 1 ? '\n' : '';
      if (part + end !== '')
        runs.push(chosen(line) ? listed({ ...run, text: part + end }, list) : { ...run, text: part + end });
      if (end) line += 1;
    });
  }
  return withMerged(el, runs);
}

/** The box with these runs, look-alike neighbours joined; no runs when none has a look of its own. */
function withMerged(el: TextElement, runs: readonly TextRun[]): TextElement {
  const merged: TextRun[] = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (last && sameLook(last, run)) merged[merged.length - 1] = { ...last, text: last.text + run.text };
    else merged.push({ ...run });
  }
  const { runs: _old, ...rest } = el;
  const text = merged.map((r) => r.text).join('');
  const styled = merged.some((r) => Object.keys(r).some((k) => k !== 'text'));
  return styled ? { ...rest, text, runs: merged } : { ...rest, text };
}

/** Two runs look the same: every setting but their words alike. */
function sameLook(a: TextRun, b: TextRun): boolean {
  const { text: _a, ...la } = a;
  const { text: _b, ...lb } = b;
  const ka = Object.keys(la).filter((k) => la[k as keyof typeof la] !== undefined);
  const kb = Object.keys(lb).filter((k) => lb[k as keyof typeof lb] !== undefined);
  return (
    ka.length === kb.length &&
    ka.every((k) => JSON.stringify(la[k as keyof typeof la]) === JSON.stringify(lb[k as keyof typeof lb]))
  );
}

/** A line of a box as the screens draw a list: its runs' pieces (each with its run's place), and its mark. */
export interface DrawnLine {
  pieces: { run: TextRun; index: number; text: string }[];
  /** The run whose line break ends the line (its look sizes a blank line); null for the last line. */
  end: TextRun | null;
  mark: LineMark;
}

/** A box's runs as lines with their marks, for drawing a list line by line. */
export function drawnLines(runs: readonly TextRun[]): DrawnLine[] {
  const lines: Omit<DrawnLine, 'mark'>[] = [{ pieces: [], end: null }];
  runs.forEach((run, index) => {
    if (run.softBreak && /^\n+$/u.test(run.text)) {
      lines.at(-1)?.pieces.push({ run, index, text: run.text });
      return;
    }
    const parts = run.text.split('\n');
    parts.forEach((part, i) => {
      const line = lines[lines.length - 1];
      if (!line) return;
      if (part !== '') line.pieces.push({ run, index, text: part });
      if (i < parts.length - 1) {
        line.end = run;
        lines.push({ pieces: [], end: null });
      }
    });
  });
  const marks = lineMarks(lines.map((l) => l.pieces.map((p) => ({ ...p.run, text: p.text }))));
  return lines.map((line, i) => ({ ...line, mark: marks[i] ?? { mark: null, level: 0, label: null } }));
}

/** The box with each of its list's lines a level further in (1) or back out (-1), within reach. */
export function shiftListLevel(el: TextElement, by: 1 | -1): TextElement {
  if (!el.runs || !hasList(el)) return el;
  const runs = el.runs.map((run) => {
    if (!run.list) return run;
    const { level: _was, ...rest } = run;
    const level = clampLevel((run.level ?? 0) + by);
    return level > 0 ? { ...rest, level } : rest;
  });
  return withMerged(el, runs);
}
