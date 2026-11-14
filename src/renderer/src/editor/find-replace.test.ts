import { describe, expect, it } from 'vitest';
import type { SlideElement, TextElement, TextRun } from '../../../shared/model';
import type { EditDoc, EditSlide } from '../../../shared/slide-edit';
import { findMatches, matchContext, replaceMatches } from './find-replace';

/*
 * Find and replace across the presentation (Session 55, Part 17a): every text box's words, slide by slide, in the
 * order the slides are in; a match never in words typed in a legacy font (their letters are codes); Match case and
 * Whole words; Gujarati and Devanagari as they are written (NFC), a word's letters and marks kept together. Replaced
 * words take the look of the words they replace, each run its own; words in another script carry their language.
 */

const style: TextElement['style'] = {
  fontFamily: null,
  fontSize: 80,
  fontWeight: 500,
  color: '#ffffff',
  align: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.35,
  shadow: true,
};

const words = (
  id: string,
  text: string,
  lang: TextElement['lang'] = 'en',
  runs?: TextRun[],
): TextElement => ({
  id,
  kind: 'text',
  frame: { x: 0, y: 0, width: 1600, height: 300 },
  text: runs ? runs.map((r) => r.text).join('') : text,
  lang,
  style,
  ...(runs ? { runs } : {}),
});

const slide = (id: string, elements: SlideElement[]): EditSlide => ({
  id,
  label: '',
  notes: '',
  background: null,
  darken: null,
  enabled: true,
  transition: null,
  autoAdvanceMs: null,
  macroId: null,
  elements,
  cues: [],
});

const doc: EditDoc = {
  presentationId: 'p',
  name: 'Placeholder Find',
  width: 1920,
  height: 1080,
  transition: null,
  loop: false,
  groups: [
    {
      id: 'g1',
      name: 'Verse',
      color: null,
      slides: [
        slide('s1', [words('e1', 'Placeholder alpha words')]),
        slide('s2', [words('e2', 'Placeholder beta words')]),
        slide('s3', [
          words('e3', '', 'en', [
            { text: 'Placeholder ', size: 70 },
            { text: 'alpha', color: '#ffcc00' },
            { text: ' again' },
          ]),
        ]),
      ],
    },
    {
      id: 'g2',
      name: 'Chorus',
      color: null,
      slides: [
        slide('s4', [words('e4', 'નમૂના શબ્દ', 'gu')]),
        slide('s5', [words('e5', '', null, [{ text: 'alpha', font: 'Gopika', legacy: true }])]),
        slide('s6', [
          {
            id: 'shape',
            kind: 'shape',
            frame: { x: 0, y: 0, width: 10, height: 10 },
            fill: null,
            cornerRadius: 0,
            opacity: 1,
          },
          words('e6', '', 'en', [
            { text: 'Place', size: 60 },
            { text: 'holder', size: 80 },
          ]),
          words('e7', 'Namūnā line'),
        ]),
      ],
    },
  ],
};

const plain = { matchCase: false, wholeWords: false };
const textOf = (d: EditDoc, slideId: string, elementId: string) =>
  d.groups
    .flatMap((g) => g.slides)
    .find((s) => s.id === slideId)
    ?.elements.find((e) => e.id === elementId) as TextElement | undefined;

describe('finding', () => {
  it('finds every match across the slides, in their order, never in legacy-font words', () => {
    const found = findMatches(doc, 'alpha', plain);
    expect(found.map((m) => [m.slideId, m.elementId, m.start, m.end])).toEqual([
      ['s1', 'e1', 12, 17],
      ['s3', 'e3', 12, 17],
    ]);
    expect(findMatches(doc, '', plain)).toEqual([]);
    expect(findMatches(doc, '   ', plain)).toEqual([]);
  });

  it('matches case or not, and whole words or not', () => {
    expect(findMatches(doc, 'ALPHA', plain)).toHaveLength(2);
    expect(findMatches(doc, 'ALPHA', { matchCase: true, wholeWords: false })).toHaveLength(0);
    expect(findMatches(doc, 'alph', plain)).toHaveLength(2);
    expect(findMatches(doc, 'alph', { matchCase: false, wholeWords: true })).toHaveLength(0);
    expect(findMatches(doc, 'placeholder', { matchCase: false, wholeWords: true })).toHaveLength(4);
  });

  it('finds Gujarati words whole, and words however they were typed (NFC)', () => {
    expect(findMatches(doc, 'નમૂના', plain).map((m) => m.elementId)).toEqual(['e4']);
    expect(findMatches(doc, 'નમૂના', { matchCase: false, wholeWords: true })).toHaveLength(1);
    // Part of a word: its letters go on after it.
    expect(findMatches(doc, 'નમૂ', { matchCase: false, wholeWords: true })).toHaveLength(0);
    // Typed with a combining macron, written with the composed letter.
    expect(findMatches(doc, 'Namūnā', plain).map((m) => m.elementId)).toEqual(['e7']);
  });

  it('says the words round a match', () => {
    const [, second] = findMatches(doc, 'alpha', plain);
    if (!second) throw new Error('no match');
    expect(matchContext(doc, second)).toEqual({ before: 'Placeholder ', words: 'alpha', after: ' again' });
  });
});

describe('replacing', () => {
  it('replaces every match, each in the look of the words it replaces, and nothing else', () => {
    const next = replaceMatches(doc, findMatches(doc, 'alpha', plain), 'gamma');
    expect(textOf(next, 's1', 'e1')).toMatchObject({ text: 'Placeholder gamma words', lang: 'en' });
    expect(textOf(next, 's1', 'e1')?.runs).toBeUndefined();
    expect(textOf(next, 's3', 'e3')?.runs).toEqual([
      { text: 'Placeholder ', size: 70 },
      { text: 'gamma', color: '#ffcc00' },
      { text: ' again' },
    ]);
    expect(textOf(next, 's3', 'e3')?.text).toBe('Placeholder gamma again');
    // The legacy-font words and the other slides as they were.
    expect(textOf(next, 's5', 'e5')).toEqual(textOf(doc, 's5', 'e5'));
    expect(next.groups[0]?.slides[1]).toBe(doc.groups[0]?.slides[1]);
  });

  it('a box whose words it replaced loses PowerPoint’s own shrink of its old words (Session 58, FT-5); the others keep theirs', () => {
    const shrunk = (el: TextElement): TextElement => ({
      ...el,
      style: { ...el.style, shrinkToFit: true, sourceFit: { fontScale: 0.8, lineSpacingReduction: 0.2 } },
    });
    const fitted: EditDoc = {
      ...doc,
      groups: doc.groups.map((g) => ({
        ...g,
        slides: g.slides.map((sl) => ({
          ...sl,
          elements: sl.elements.map((e) => (e.kind === 'text' ? shrunk(e) : e)),
        })),
      })),
    };
    const [first] = findMatches(fitted, 'alpha', plain);
    if (!first) throw new Error('no match');
    const next = replaceMatches(fitted, [first], 'gamma');
    expect(textOf(next, 's1', 'e1')?.style).not.toHaveProperty('sourceFit');
    expect(textOf(next, 's1', 'e1')?.style.shrinkToFit).toBe(true);
    expect(textOf(next, 's3', 'e3')?.style.sourceFit).toEqual({ fontScale: 0.8, lineSpacingReduction: 0.2 });
  });

  it('replaces one match only, when asked', () => {
    const [first] = findMatches(doc, 'alpha', plain);
    if (!first) throw new Error('no match');
    const next = replaceMatches(doc, [first], 'gamma');
    expect(textOf(next, 's1', 'e1')?.text).toBe('Placeholder gamma words');
    expect(textOf(next, 's3', 'e3')?.text).toBe('Placeholder alpha again');
  });

  it('a match across two runs takes the first one’s look', () => {
    const next = replaceMatches(
      doc,
      findMatches(doc, 'Placeholder', { matchCase: true, wholeWords: true }),
      'Sample',
    );
    expect(textOf(next, 's6', 'e6')?.runs).toEqual([{ text: 'Sample', size: 60 }]);
    expect(textOf(next, 's6', 'e6')?.text).toBe('Sample');
  });

  it('Gujarati for Gujarati keeps its language; words in another script carry their own', () => {
    const gu = replaceMatches(doc, findMatches(doc, 'નમૂના', plain), 'બીજું');
    expect(textOf(gu, 's4', 'e4')).toMatchObject({ text: 'બીજું શબ્દ', lang: 'gu' });
    const mixed = replaceMatches(doc, findMatches(doc, 'alpha', plain).slice(0, 1), 'નમૂના');
    expect(textOf(mixed, 's1', 'e1')).toMatchObject({
      text: 'Placeholder નમૂના words',
      lang: 'en',
      runs: [{ text: 'Placeholder ' }, { text: 'નમૂના', lang: 'gu' }, { text: ' words' }],
    });
  });

  it('replaced with nothing: the words go', () => {
    const next = replaceMatches(doc, findMatches(doc, 'beta ', plain), '');
    expect(textOf(next, 's2', 'e2')?.text).toBe('Placeholder words');
  });
});
