import { describe, expect, it } from 'vitest';
import { swings } from './flash';
import { animationById } from './lower-third-animations';
import {
  cutLine,
  OPENING_DEFAULT,
  OPENING_LINE_MAX,
  OPENING_LINES_MAX,
  OPENING_MS,
  OPENING_PHOTOS_MAX,
  OPENING_WORDS,
  openingSparkles,
  openingTimes,
  packLines,
  packMissing,
  readOpening,
  wordFrames,
} from './opening';

/*
 * The opening (Session 55, the owner's brief of 3 Nov 2026 and answer of 4 Nov): what is kept, read forgivingly; the
 * five seconds shared by its photos and, side by side, by its lines (five of each: a photo with its own line, a
 * second each; the pack's eight photos: 625 ms each under five lines of a second); the words with a Lower Thirds
 * studio move; the sparkles; and the opening pack's lines and what a pack is missing. Placeholder words only.
 */

const id = (n: number) => `placeholder-photo-${String(n)}`;

describe('what is kept', () => {
  it('is on with nothing chosen when nothing is kept, or what is kept cannot be read', () => {
    expect(readOpening(undefined)).toEqual(OPENING_DEFAULT);
    expect(readOpening('on')).toEqual(OPENING_DEFAULT);
    expect(OPENING_DEFAULT).toEqual({ on: true, photos: [], lines: [] });
  });

  it('keeps at most eight photos and five lines, leaving out what it cannot read, never the rest', () => {
    const kept = readOpening({
      on: false,
      photos: [id(1), 'not a media id!', 7, ...[2, 3, 4, 5, 6, 7, 8, 9].map(id)],
      lines: [
        '  Placeholder   line one ',
        3,
        '',
        ...[2, 3, 4, 5, 6].map((n) => `Placeholder line ${String(n)}`),
      ],
    });
    expect(kept.on).toBe(false);
    expect(kept.photos).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(id));
    expect(OPENING_PHOTOS_MAX).toBe(8);
    expect(kept.lines).toEqual([
      'Placeholder line one',
      'Placeholder line 2',
      'Placeholder line 3',
      'Placeholder line 4',
      'Placeholder line 5',
    ]);
    expect(OPENING_LINES_MAX).toBe(5);
    // A list that is not one is left out by itself.
    expect(readOpening({ photos: 'x', lines: [' Placeholder '] })).toEqual({
      on: true,
      photos: [],
      lines: ['Placeholder'],
    });
  });

  it('cuts a long line between letters, never inside a Gujarati conjunct', () => {
    const long = 'ક્ષ '.repeat(60);
    const line = readOpening({ lines: [long] }).lines[0] ?? '';
    expect(line.length).toBeLessThanOrEqual(OPENING_LINE_MAX);
    expect(line.endsWith('ક્ષ')).toBe(true);
  });
});

describe('the five seconds', () => {
  it('five photos and five lines: each photo with its own line, a second each, the first from the dark', () => {
    const t = openingTimes(5, [3, 4, 5, 4, 6]);
    expect(t.end).toBe(OPENING_MS);
    expect(t.photos.map((p) => [p.start, p.end])).toEqual([
      [0, 1000],
      [1000, 2000],
      [2000, 3000],
      [3000, 4000],
      [4000, 5000],
    ]);
    expect(t.lines.map((l) => [l.start, l.end])).toEqual(t.photos.map((p) => [p.start, p.end]));
    for (const p of t.photos) {
      expect(p.sweep.start).toBeGreaterThanOrEqual(p.start);
      expect(p.sweep.start + p.sweep.length).toBeLessThanOrEqual(p.end);
    }
    expect(t.photos[0]?.fadeIn).toBeGreaterThan(t.photos[1]?.fadeIn ?? 0);
    for (const [i, l] of t.lines.entries()) {
      // Every word in well before the line's second ends: it is read whole for a while.
      const words = [3, 4, 5, 4, 6][i] ?? 0;
      expect(l.words.start + (words - 1) * l.words.stagger + l.words.each).toBeLessThanOrEqual(l.start + 700);
      if (i < 4) expect(l.lineOut).toBeLessThanOrEqual(l.end - 100);
      else expect(l.lineOut).toBeNull();
    }
    expect(t.fadeOut.start + t.fadeOut.length).toBe(OPENING_MS);
  });

  it('the pack’s eight photos come every 625 ms under its five lines of a second each', () => {
    const t = openingTimes(8, [4, 5, 5, 4, 6]);
    expect(t.photos.map((p) => p.start)).toEqual([0, 625, 1250, 1875, 2500, 3125, 3750, 4375]);
    expect(t.photos.at(-1)?.end).toBe(OPENING_MS);
    expect(t.lines.map((l) => l.start)).toEqual([0, 1000, 2000, 3000, 4000]);
    for (const p of t.photos) expect(p.sweep.start + p.sweep.length).toBeLessThanOrEqual(p.end);
  });

  it('the photos alone, or the lines over the lamp once it is lit; with nothing, the lamp and Drashti’s name', () => {
    expect(openingTimes(2, []).photos.map((p) => [p.start, p.end])).toEqual([
      [0, 2500],
      [2500, 5000],
    ]);
    expect(openingTimes(2, []).lines).toEqual([]);
    const lamp = openingTimes(0, [2, 2]);
    expect(lamp.photos).toEqual([]);
    expect(lamp.lines.map((l) => [l.start, l.end])).toEqual([
      [lamp.lampWords, 3000],
      [3000, 5000],
    ]);
    expect(lamp.lampWords).toBeGreaterThanOrEqual(900);
    expect(openingTimes(0, []).end).toBe(OPENING_MS);
  });

  it('a long line comes in faster, so all of it is in by its second’s middle', () => {
    const l = openingTimes(5, [14, 1, 1, 1, 1]).lines[0];
    if (!l) throw new Error('no line');
    expect(l.words.stagger).toBeLessThan(animationById(OPENING_WORDS).timing.stagger ?? 0);
    expect(l.words.start + 13 * l.words.stagger + l.words.each).toBeLessThanOrEqual(l.start + 700);
  });
});

describe('the words, with the Lower Thirds studio’s move', () => {
  it('is one of the studio’s word moves, of opacity and transform only', () => {
    const a = animationById(OPENING_WORDS);
    expect(a.id).toBe(OPENING_WORDS);
    expect(a.unit).toBe('word');
    const frames = wordFrames(0);
    expect(frames[0]).toMatchObject({ offset: 0, opacity: 0 });
    expect(frames.at(-1)).toEqual({ offset: 1, opacity: 1, transform: 'none' });
    for (const f of frames) expect(Object.keys(f).sort()).toEqual(['offset', 'opacity', 'transform']);
  });

  it('cuts a line into whole words, a Gujarati or Hindi conjunct never split', () => {
    const { pieces, units } = cutLine('ક્ષ સ્વ दृश्य word');
    expect(units).toBe(4);
    expect(pieces.filter((p) => p.unit !== null).map((p) => p.text)).toEqual(['ક્ષ', 'સ્વ', 'दृश्य', 'word']);
    expect(pieces.map((p) => p.text).join('')).toBe('ક્ષ સ્વ दृश्य word');
  });
});

describe('the sparkles', () => {
  it('a few, small, each glinting once, never more than one starting in any third of a second', () => {
    const all = openingSparkles();
    expect(all.length).toBeGreaterThanOrEqual(6);
    expect(all.length).toBeLessThanOrEqual(16);
    for (const s of all) {
      expect(s.size).toBeLessThanOrEqual(12);
      expect(s.length).toBeGreaterThanOrEqual(800);
      expect(s.start + s.length).toBeLessThanOrEqual(OPENING_MS - 300);
      // Above where the words are.
      expect(s.y).toBeLessThanOrEqual(66);
    }
    const starts = all.map((s) => s.start).sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i++)
      expect((starts[i] ?? 0) - (starts[i - 1] ?? 0)).toBeGreaterThanOrEqual(1000 / 3);
    // The same every time (no flicker between starts, and a test sees what a person sees).
    expect(openingSparkles()).toEqual(all);
  });

  it('a sparkle’s glint is one rise and one fall: well under three swings a second', () => {
    const series = Array.from({ length: 61 }, (_, i) => Math.sin((i / 60) * Math.PI));
    expect(swings(series, 60).worst).toBeLessThanOrEqual(2);
  });
});

describe('the opening pack', () => {
  it('reads its lines one to a line, whatever the computer wrote: no BOM, no empty lines, NFC', () => {
    expect(packLines('\uFEFFPlaceholder one\r\n\r\n  Placeholder two  \nક્ષ\n')).toEqual([
      'Placeholder one',
      'Placeholder two',
      'ક્ષ'.normalize('NFC'),
    ]);
  });

  it('says what a pack is missing: its eight photos by number and file, and its five lines', () => {
    const all = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(packMissing({ photos: all, lines: 5 })).toBeNull();
    expect(packMissing({ photos: [1, 2, 3, 4, 5, 6], lines: 5 })).toBe(
      'The opening pack is missing photos 7 and 8 (photos/7.jpg and photos/8.jpg). Nothing was changed.',
    );
    expect(packMissing({ photos: all, lines: 3 })).toBe(
      'The opening pack has 3 lines of the 5 in words.txt. Nothing was changed.',
    );
    expect(packMissing({ photos: [1, 2, 3, 4, 5, 6, 7], lines: 0 })).toBe(
      'The opening pack is missing photo 8 (photos/8.jpg), and has no lines in words.txt. Nothing was changed.',
    );
  });
});
