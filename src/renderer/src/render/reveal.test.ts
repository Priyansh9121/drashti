import { describe, expect, it } from 'vitest';
import { hasWords, linesReveal, revealLines, wordUnits, wordsReveal } from './reveal';

/* The words line by line or word by word (Session 27): how a box's words are cut, and when each comes. */

const graphemes = (text: string, locale: string) =>
  [...new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(text)].map((s) => s.index);

describe('word by word', () => {
  it('cuts English into words, each with the spaces and marks after it; joined, they are the text', () => {
    expect(wordUnits('Placeholder words, two.', 'en')).toEqual(['Placeholder ', 'words, ', 'two.']);
    expect(wordUnits('“Placeholder” line', 'en')).toEqual(['“Placeholder” ', 'line']);
    expect(wordUnits('   ', 'en')).toEqual(['   ']);
  });

  it('never splits a Gujarati or a Devanagari letter cluster: every cut is between whole letters', () => {
    // Placeholder words: "sample line" in Gujarati and in Hindi.
    for (const [text, locale] of [
      ['નમૂના પંક્તિ, બીજી નમૂના પંક્તિ', 'gu'],
      ['नमूना पंक्ति, दूसरी नमूना पंक्ति', 'hi'],
      ['નમૂના पंक्ति placeholder', 'gu'],
    ] as const) {
      const units = wordUnits(text, locale);
      expect(units.join(''), text).toBe(text);
      expect(units.length, text).toBeGreaterThan(1);
      const whole = new Set(graphemes(text, locale));
      let at = 0;
      for (const unit of units) {
        expect(whole.has(at), `${text}: a cut at ${String(at)} inside a letter`).toBe(true);
        at += unit.length;
      }
    }
  });
});

describe('a box’s words as lines', () => {
  it('splits at each line break, which stays with its own run; a blank line takes no turn', () => {
    const lines = revealLines([
      { text: 'Placeholder one\nPlaceholder ', size: 80 },
      { text: 'two\n\nPlaceholder three', size: 60 },
    ]);
    expect(lines.map((l) => l.pieces.map((p) => p.text).join(''))).toEqual([
      'Placeholder one\n',
      'Placeholder two\n',
      '\n',
      'Placeholder three',
    ]);
    expect(lines[0]?.pieces.map((p) => p.run.size)).toEqual([80, 80]);
    expect(lines[1]?.pieces.map((p) => p.run.size)).toEqual([80, 60, 60]);
    expect(lines.map(hasWords)).toEqual([true, true, false, true]);
  });
});

describe('when each line or word comes (the lab’s timings, fitted into the transition)', () => {
  it('line by line: the old lines go first, then the new come one after another; all in place at the end', () => {
    for (const movement of ['calm', 'bold'] as const) {
      const r = linesReveal(movement, 3, 2);
      expect(r.in(0, 0)).toEqual({ opacity: 0, rise: movement === 'bold' ? 24 : 0 });
      expect(r.out(0, 0).opacity).toBe(1);
      expect(Math.abs(r.out(0, 0).rise)).toBe(0);
      for (let i = 0; i < 3; i++) expect(r.in(i, r.total)).toEqual({ opacity: 1, rise: 0 });
      for (let i = 0; i < 2; i++) expect(r.out(i, r.total).opacity).toBe(0);
      // One after another: the second line is behind the first part-way.
      expect(r.in(1, r.total / 2).opacity).toBeLessThan(r.in(0, r.total / 2).opacity);
    }
    expect(linesReveal('bold', 3, 2).total).toBe(200 + 2 * 150 + 520);
    expect(linesReveal('calm', 3, 2).total).toBe(200 + 2 * 120 + 420);
  });

  it('word by word: the old words go together, the new come one by one, line by line, rising in Bold only', () => {
    const r = wordsReveal('bold', [3, 2]);
    expect(r.total).toBe(250 + 180 + 90 + 520);
    expect(r.out(0)).toBe(1);
    expect(r.out(300)).toBe(0);
    expect(r.in(0, 0, 0)).toEqual({ opacity: 0, rise: 16 });
    expect(r.in(1, 1, r.total)).toEqual({ opacity: 1, rise: 0 });
    expect(r.in(0, 2, 400).opacity).toBeLessThan(r.in(0, 0, 400).opacity);
    expect(wordsReveal('calm', [3]).in(0, 0, 100).rise).toBe(0);
  });
});
