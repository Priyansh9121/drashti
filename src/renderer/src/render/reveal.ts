import type { Movement } from '../../../shared/looks';
import type { TextRun } from '../../../shared/model';
import { EASE, seg } from './easing';

/*
 * The words line by line, or word by word (Session 27, the design lab's): the words come in one line, or
 * one word, after another while the slide's pictures dissolve. The lab's own timings, in ms at its pace,
 * are fitted into the transition's length (Movement never changes it): the last line or word is in place
 * as the transition ends. A word is what the language's own rules say (Intl.Segmenter, in each line's
 * language), so a Gujarati or Devanagari letter cluster is never split.
 */

/** One line of a text box: its runs' pieces, each with the run it came from (a line break with the run it was in). */
export interface RevealLine {
  pieces: { run: TextRun; text: string }[];
}

/** A text box's runs as lines: split at each line break, which stays with its own run (so nothing shifts). */
export function revealLines(runs: readonly TextRun[]): RevealLine[] {
  const lines: RevealLine[] = [{ pieces: [] }];
  for (const run of runs) {
    const parts = run.text.split('\n');
    parts.forEach((part, i) => {
      const line = lines[lines.length - 1];
      if (!line) return;
      if (part) line.pieces.push({ run, text: part });
      if (i < parts.length - 1) {
        line.pieces.push({ run, text: '\n' });
        lines.push({ pieces: [] });
      }
    });
  }
  return lines;
}

/** Whether a line has words to show (a blank line takes no turn). */
export const hasWords = (line: RevealLine): boolean => line.pieces.some((p) => p.text.trim() !== '');

/**
 * Text cut into words, each with the spaces and marks after it (and before the first word, any marks before
 * it), as the language's own rules find words: joined again, they are the text exactly.
 */
export function wordUnits(text: string, locale: string | undefined): string[] {
  const units: string[] = [];
  let current = '';
  let hasWord = false;
  for (const s of new Intl.Segmenter(locale, { granularity: 'word' }).segment(text)) {
    if (s.isWordLike) {
      if (hasWord) {
        units.push(current);
        current = '';
      }
      current += s.segment;
      hasWord = true;
    } else current += s.segment;
  }
  if (current) units.push(current);
  return units;
}

/** Where a line or word is part-way: how much of it shows, and how far below its place it is (slide px at 1080). */
export interface UnitFrame {
  opacity: number;
  rise: number;
}

/** Line by line (the lab's): the old lines go one after another, then the new ones come, rising in Bold. */
export function linesReveal(movement: Movement, newLines: number, oldLines: number) {
  const bold = movement === 'bold';
  const gap = bold ? 150 : 120;
  const length = bold ? 520 : 420;
  const total = Math.max(
    200 + Math.max(0, newLines - 1) * gap + length,
    Math.max(0, oldLines - 1) * 40 + 260,
  );
  return {
    /** The lab's length for these lines, in ms: the transition's own is fitted to it. */
    total,
    out(i: number, t: number): UnitFrame {
      const x = seg(t, i * 40, 260, EASE.smooth);
      return { opacity: 1 - x, rise: bold ? -12 * x : 0 };
    },
    in(i: number, t: number): UnitFrame {
      const x = seg(t, 200 + i * gap, length, EASE.out);
      return { opacity: x, rise: bold ? 24 * (1 - x) : 0 };
    },
  };
}

/** Word by word (the lab's): the old words go together, then the new ones come one by one, line by line, rising in Bold. */
export function wordsReveal(movement: Movement, newWordsPerLine: readonly number[]) {
  const bold = movement === 'bold';
  const gap = bold ? 90 : 70;
  const lineGap = bold ? 180 : 160;
  const length = bold ? 520 : 380;
  let total = 300;
  newWordsPerLine.forEach((n, line) => {
    if (n > 0) total = Math.max(total, 250 + line * lineGap + (n - 1) * gap + length);
  });
  return {
    total,
    /** How much of the old words still shows. */
    out(t: number): number {
      return 1 - seg(t, 0, 300, EASE.smooth);
    },
    in(line: number, word: number, t: number): UnitFrame {
      const x = seg(t, 250 + line * lineGap + word * gap, length, EASE.out);
      return { opacity: x, rise: bold ? 16 * (1 - x) : 0 };
    },
  };
}
