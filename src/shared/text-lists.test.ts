import { describe, expect, it } from 'vitest';
import type { TextElement, TextRun } from './model';
import { slideElementSchema, textRunSchema, textStyleSchema } from './model-schema';
import { lineListOf, lineMarks, listLabel, withLinesListed } from './text-lists';
import { mergeRuns } from './text-runs';
import { boxLines, withLines } from './tracks';

/*
 * Bullets and numbering (Session 55, Part 17a): a line of a text box is one of a list when its runs say so (`list`,
 * and `level` for one further in), so a line keeps its mark wherever it goes (the kirtan's language view moves whole
 * lines). Numbers count the list's lines at their level, in Gujarati or Devanagari digits too; a blank line takes no
 * number and breaks nothing.
 */

const box = (runs: TextRun[]): TextElement => ({
  id: 'b',
  kind: 'text',
  frame: { x: 0, y: 0, width: 800, height: 300 },
  text: runs.map((r) => r.text).join(''),
  lang: null,
  style: {
    fontFamily: null,
    fontSize: 80,
    fontWeight: 500,
    color: '#ffffff',
    align: 'left',
    verticalAlign: 'top',
    lineHeight: 1.35,
    shadow: true,
  },
  runs,
});

describe('a number’s label', () => {
  it('in each way of numbering', () => {
    expect([1, 2, 10].map((n) => listLabel(n, '1'))).toEqual(['1.', '2.', '10.']);
    expect([1, 2, 12].map((n) => listLabel(n, 'gu'))).toEqual(['૧.', '૨.', '૧૨.']);
    expect([1, 2, 12].map((n) => listLabel(n, 'hi'))).toEqual(['१.', '२.', '१२.']);
    expect([1, 2, 26, 27].map((n) => listLabel(n, 'a'))).toEqual(['a.', 'b.', 'z.', 'aa.']);
    expect([1, 3].map((n) => listLabel(n, 'A'))).toEqual(['A.', 'C.']);
    expect([1, 4, 9, 14, 40].map((n) => listLabel(n, 'i'))).toEqual(['i.', 'iv.', 'ix.', 'xiv.', 'xl.']);
  });
});

describe('each line’s mark', () => {
  it('reads a line’s list from its runs, its level left out for the first', () => {
    expect(lineListOf([{ text: 'a', list: 'disc' }])).toEqual({ mark: 'disc', level: 0 });
    expect(lineListOf([{ text: 'a', list: '1', level: 2 }])).toEqual({ mark: '1', level: 2 });
    expect(lineListOf([{ text: 'a' }])).toEqual({ mark: null, level: 0 });
    expect(lineListOf([])).toEqual({ mark: null, level: 0 });
  });

  it('numbers the list’s lines; a blank line takes no number; words outside the list start it again', () => {
    const el = box([
      { text: 'Placeholder title\n' },
      { text: 'one\ntwo\n', list: '1' },
      { text: '\n' },
      { text: 'three\n', list: '1' },
      { text: 'further in\n', list: 'a', level: 1 },
      { text: 'further still\n', list: 'a', level: 1 },
      { text: 'four\n', list: '1' },
      { text: 'outside\n' },
      { text: 'again', list: '1' },
    ]);
    expect(lineMarks(boxLines(el).map((l) => l.runs))).toEqual([
      { mark: null, level: 0, label: null },
      { mark: '1', level: 0, label: '1.' },
      { mark: '1', level: 0, label: '2.' },
      { mark: null, level: 0, label: null },
      { mark: '1', level: 0, label: '3.' },
      { mark: 'a', level: 1, label: 'a.' },
      { mark: 'a', level: 1, label: 'b.' },
      { mark: '1', level: 0, label: '4.' },
      { mark: null, level: 0, label: null },
      { mark: '1', level: 0, label: '1.' },
    ]);
  });

  it('continues repeated imported start numbers and resets when the start changes', () => {
    const starts = [5, 5, 5, 7, undefined, 7];
    const lines: TextRun[][] = starts.map((startAt) => [
      { text: 'Placeholder numbered line', list: '1', paragraph: { align: 'left', startAt } },
    ]);
    expect(lineMarks(lines).map(({ label }) => label)).toEqual(['5.', '6.', '7.', '7.', '8.', '9.']);
  });

  it('gives bullets no label, and a bullet between numbers starts the numbers again', () => {
    const el = box([
      { text: 'one\n', list: '1' },
      { text: 'dot\n', list: 'disc' },
      { text: 'one again', list: '1' },
    ]);
    expect(lineMarks(boxLines(el).map((l) => l.runs)).map((m) => m.label)).toEqual(['1.', null, '1.']);
  });

  it('a blank line in a list has no mark of its own', () => {
    const el = box([{ text: 'one\n\ntwo', list: 'disc' }]);
    expect(lineMarks(boxLines(el).map((l) => l.runs)).map((m) => m.mark)).toEqual(['disc', null, 'disc']);
  });
});

describe('lines made into a list, and back', () => {
  it('marks every run of the lines chosen (all of them, or some), and takes the mark off again', () => {
    const el = box([
      { text: 'Placeholder title\n', size: 90 },
      { text: 'one\n', color: '#ffcc00' },
      { text: 'two' },
    ]);
    const listed = withLinesListed(el, [1, 2], { mark: 'disc' });
    expect(listed.runs).toEqual([
      { text: 'Placeholder title\n', size: 90 },
      { text: 'one\n', color: '#ffcc00', list: 'disc' },
      { text: 'two', list: 'disc' },
    ]);
    expect(listed.text).toBe(el.text);
    const all = withLinesListed(el, 'all', { mark: 'gu' });
    expect(lineMarks(boxLines(all).map((l) => l.runs)).map((m) => m.label)).toEqual(['૧.', '૨.', '૩.']);
    // Further in, then off again: the runs are as they were.
    const further = withLinesListed(listed, [2], { mark: 'disc', level: 1 });
    expect(further.runs?.at(-1)).toEqual({ text: 'two', list: 'disc', level: 1 });
    expect(withLinesListed(listed, 'all', null).runs).toEqual(el.runs);
  });

  it('gives a box of plain text runs to carry the mark', () => {
    const plain: TextElement = { ...box([]), text: 'one\ntwo', lang: 'en' };
    delete plain.runs;
    expect(withLinesListed(plain, 'all', { mark: 'square' }).runs).toEqual([
      { text: 'one\ntwo', list: 'square' },
    ]);
  });

  it('a line keeps its mark when the language view moves lines about', () => {
    const el = box([
      { text: 'નમૂના\n', lang: 'gu', list: 'disc' },
      { text: 'Namūnā', lang: 'translit', list: 'disc', italic: true },
    ]);
    const lines = boxLines(el);
    const swapped = withLines(
      el,
      [lines[1], lines[0]].filter((l) => l !== undefined),
    );
    expect(lineMarks(boxLines(swapped).map((l) => l.runs)).map((m) => m.mark)).toEqual(['disc', 'disc']);
  });
});

describe('the new looks of words are kept', () => {
  it('runs that differ only in underline, strike through, glow or list are not merged', () => {
    expect(
      mergeRuns([
        { text: 'a' },
        { text: 'b', underline: true },
        { text: 'c', strike: true },
        { text: 'd', glow: { color: '#ffcc00', size: 12 } },
        { text: 'e', list: 'disc' },
        { text: 'f', list: 'disc', level: 1 },
      ]).map((r) => r.text),
    ).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(
      mergeRuns([
        { text: 'a', underline: true },
        { text: 'b', underline: true },
      ]),
    ).toEqual([{ text: 'ab', underline: true }]);
  });

  it('a run’s underline, strike through, glow, list and level, and a box’s glow, pass the checks whole', () => {
    const run: TextRun = {
      text: 'a',
      underline: true,
      strike: true,
      glow: { color: '#00ffcc', size: 20 },
      list: 'gu',
      level: 2,
    };
    expect(textRunSchema.parse(run)).toEqual(run);
    expect(textRunSchema.parse({ text: 'a', glow: null })).toEqual({ text: 'a', glow: null });
    const style = { ...box([]).style, glow: { color: '#00ffcc80', size: 30 } };
    expect(textStyleSchema.parse(style)).toEqual(style);
    const el = box([run]);
    expect(slideElementSchema.parse(el)).toEqual(el);
  });

  it('refuses a list mark or level it does not know, and a glow out of reach', () => {
    expect(textRunSchema.safeParse({ text: 'a', list: 'star' }).success).toBe(false);
    expect(textRunSchema.safeParse({ text: 'a', list: 'disc', level: 9 }).success).toBe(false);
    expect(textRunSchema.safeParse({ text: 'a', glow: { color: 'red', size: 4 } }).success).toBe(false);
    expect(textRunSchema.safeParse({ text: 'a', glow: { color: '#ffffff', size: -1 } }).success).toBe(false);
  });
});
