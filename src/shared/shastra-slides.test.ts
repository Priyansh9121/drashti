import { describe, expect, it } from 'vitest';
import type { TextElement } from './model';
import { passageSlides, wrappedLines } from './shastra-slides';
import { DEFAULT_THEME } from './themes';

/* A Shastra passage as slides (placeholder words only). */

const words = (el: TextElement | undefined, lang: string) =>
  (el?.runs ?? [])
    .filter((r) => r.lang === lang)
    .map((r) => r.text.trim())
    .join('\n');

const boxes = (slide: { elements: unknown[] }) => slide.elements as TextElement[];

/** A long placeholder item: `n` sentences in English and in Hindi, one line each. */
function longItem(n: number) {
  const en = Array.from(
    { length: n },
    (_, i) => `Placeholder sentence number ${i + 1} of this long passage.`,
  );
  const hi = Array.from({ length: n }, (_, i) => `यह नमूना वाक्य संख्या ${i + 1} है।`);
  return { reference: 'Placeholder Vachan 1', texts: { en: en.join(' '), hi: hi.join(' ') } };
}

describe('a passage as slides', () => {
  it('gives a short item one slide: its reference line, then its words, Sanskrit first', () => {
    const [one, ...rest] = passageSlides(
      [
        {
          reference: 'Placeholder Granth 14',
          texts: { en: 'Placeholder meaning.', sa: 'नमूना श्लोकः', translit: 'namūnā ślokaḥ' },
        },
      ],
      DEFAULT_THEME,
      'shastra:pg#14',
    );
    expect(rest).toHaveLength(0);
    const [reference, body] = boxes(one?.slide ?? { elements: [] });
    expect(one?.slide.kirtan).toBe(true);
    expect(reference).toMatchObject({ text: 'Placeholder Granth 14', everyScreen: true });
    expect(body?.runs?.map((r) => r.lang)).toEqual(['sa', 'translit', 'en']);
    expect(body?.text).toBe('नमूना श्लोकः\n\nnamūnā ślokaḥ\n\nPlaceholder meaning.');
    expect(body?.style.shrinkToFit).toBe(true);
    // Below the words, when the theme says so.
    const below = passageSlides(
      [{ reference: 'Placeholder Granth 14', texts: { en: 'Placeholder meaning.' } }],
      { ...DEFAULT_THEME, reference: { ...DEFAULT_THEME.reference, place: 'bottom' } },
      'x',
    )[0];
    const [first, second] = boxes(below?.slide ?? { elements: [] });
    expect(first?.text).toBe('Placeholder meaning.');
    expect(second?.text).toBe('Placeholder Granth 14');
    expect((second?.frame.y ?? 0) > (first?.frame.y ?? 0)).toBe(true);
  });

  it('cuts a long item over several slides, every language in step, each slide fitting its box', () => {
    const slides = passageSlides([longItem(30)], DEFAULT_THEME, 'p');
    expect(slides.length).toBeGreaterThan(2);
    expect(slides.map((s) => `${s.part}/${s.of}`)[0]).toBe(`1/${slides.length}`);
    expect(boxes(slides[1]?.slide ?? { elements: [] })[0]?.text).toBe(
      `Placeholder Vachan 1 (2/${slides.length})`,
    );
    // In step: each slide's English and Hindi are the same sentences.
    for (const s of slides) {
      const body = boxes(s.slide)[1];
      const en = words(body, 'en').match(/number (\d+)/gu) ?? [];
      const hi = words(body, 'hi').match(/संख्या (\d+)/gu) ?? [];
      expect(en.map((m) => m.split(' ')[1])).toEqual(hi.map((m) => m.split(' ')[1]));
      // And it fits, by the same measure.
      const box = body?.frame.width ?? 0;
      const lines = (lang: 'en' | 'hi') =>
        words(body, lang)
          .split('\n')
          .reduce((n, l) => n + wrappedLines(l, DEFAULT_THEME.langs[lang].size, box, 500), 0);
      const height =
        (lines('en') * DEFAULT_THEME.langs.en.size +
          lines('hi') * DEFAULT_THEME.langs.hi.size +
          DEFAULT_THEME.langs.en.size) *
        DEFAULT_THEME.box.lineHeight;
      expect(height).toBeLessThanOrEqual(body?.frame.height ?? 0);
    }
    // Nothing is lost or repeated.
    const all = slides.flatMap((s) => words(boxes(s.slide)[1], 'en').match(/number \d+/gu) ?? []);
    expect(all).toHaveLength(30);
    expect(new Set(all).size).toBe(30);
  });

  it('cuts by the languages the screens show: fewer slides when they show fewer', () => {
    const every = passageSlides([longItem(30)], DEFAULT_THEME, 'p');
    const english = passageSlides([longItem(30)], DEFAULT_THEME, 'p', { designed: ['en'], lowerThirds: [] });
    expect(english.length).toBeLessThan(every.length);
  });

  it('keeps a lower third to its six lines where a group shows one', () => {
    const slides = passageSlides([longItem(12)], DEFAULT_THEME, 'p', {
      designed: 'none',
      lowerThirds: [['en']],
    });
    for (const s of slides) {
      const en = words(boxes(s.slide)[1], 'en');
      const width = 1920 * 0.88 - 2 * 0.9 * 1080 * 0.037;
      const wrapped = en.split('\n').reduce((n, l) => n + wrappedLines(l, 1080 * 0.037, width, 600), 0);
      expect(1 + wrapped).toBeLessThanOrEqual(6);
    }
    expect(slides.length).toBeGreaterThan(1);
  });

  it('starts each item on a slide of its own, with ids that stay the same', () => {
    const items = [
      { reference: 'Placeholder Granth 14', texts: { en: 'Placeholder fourteen.' } },
      { reference: 'Placeholder Granth 15', texts: { en: 'Placeholder fifteen.' } },
    ];
    const slides = passageSlides(items, DEFAULT_THEME, 'shastra:pg#14-15');
    expect(slides.map((s) => [s.slide.id, s.item])).toEqual([
      ['shastra:pg#14-15#1.1', 0],
      ['shastra:pg#14-15#2.1', 1],
    ]);
  });

  it('measures Gujarati and Devanagari words narrower than their letter count, and wraps by words', () => {
    expect(wrappedLines('Placeholder', 80, 1000)).toBe(1);
    const long = Array.from({ length: 40 }, () => 'placeholder').join(' ');
    expect(wrappedLines(long, 80, 1700)).toBeGreaterThan(3);
    // A virama joins its consonant to the next, so a cluster is narrower than two letters.
    expect(wrappedLines('क्ष', 80, 100)).toBe(1);
    expect(wrappedLines('कष', 80, 100)).toBe(2);
  });
});
