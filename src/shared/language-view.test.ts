import { describe, expect, it } from 'vitest';
import { languageView } from './language-view';
import type { RenderSlide, SlideElement, TextElement, TextRun, TextStyle } from './model';
import { slideElementSchema } from './model-schema';

/* Placeholder words only: never real kirtan text. */

const style: TextStyle = {
  fontFamily: null,
  fontSize: 80,
  fontWeight: 500,
  color: '#ffffff',
  align: 'center',
  verticalAlign: 'middle',
  lineHeight: 1.25,
  shadow: true,
  shrinkToFit: true,
};

const box = (
  id: string,
  runs: TextRun[],
  frame = { x: 100, y: 200, width: 1720, height: 600 },
): TextElement => ({
  id,
  kind: 'text',
  frame,
  text: runs.map((r) => r.text).join(''),
  lang: 'gu',
  style,
  runs,
});

const slide = (elements: SlideElement[], kirtan = true): RenderSlide => ({
  id: 's',
  width: 1920,
  height: 1080,
  background: null,
  elements,
  ...(kirtan ? { kirtan: true } : {}),
});

const kirtanBox = () =>
  box('k', [
    { text: 'નમૂનો\n', lang: 'gu', size: 90 },
    { text: 'नमूना\n', lang: 'hi', size: 80 },
    { text: 'Namuno\n', lang: 'translit', size: 60, italic: true },
    { text: 'Sample', lang: 'en', size: 50 },
  ]);

const words = (s: RenderSlide) => s.elements.map((e) => (e.kind === 'text' ? e.text : `[${e.kind}]`));

describe('a kirtan slide on a screen with its own languages', () => {
  it('shows only those languages, in the screen’s order, closed up', () => {
    const s = slide([kirtanBox()]);
    expect(words(languageView(s, ['gu', 'translit']))).toEqual(['નમૂનો\nNamuno']);
    expect(words(languageView(s, ['translit', 'en']))).toEqual(['Namuno\nSample']);
    expect(words(languageView(s, ['en', 'translit']))).toEqual(['Sample\nNamuno']);
    expect(words(languageView(s, ['gu']))).toEqual(['નમૂનો']);
    // Each line keeps its look; the box keeps its shrink-to-fit.
    const [el] = languageView(s, ['en', 'translit']).elements as [TextElement];
    expect(el.runs).toEqual([
      { text: 'Sample\n', lang: 'en', size: 50 },
      { text: 'Namuno', lang: 'translit', size: 60, italic: true },
    ]);
    expect(el.style.shrinkToFit).toBe(true);
    expect(slideElementSchema.safeParse(el).success).toBe(true);
  });

  it('shows every language as it is when the screen shows them all, and any slide that is not a kirtan’s', () => {
    const s = slide([kirtanBox()]);
    expect(languageView(s, null)).toBe(s);
    const plain = slide([kirtanBox()], false);
    expect(languageView(plain, ['gu'])).toBe(plain);
    // The same order the slide has: nothing to change.
    expect(languageView(s, ['gu', 'hi', 'translit', 'en'])).toBe(s);
  });

  it('gives the same object for the same slide and languages', () => {
    const s = slide([kirtanBox()]);
    expect(languageView(s, ['gu', 'translit'])).toBe(languageView(s, ['gu', 'translit']));
  });

  it('leaves no blank line where a language was, keeping blank lines between those left', () => {
    const s = slide([
      box('k', [
        { text: 'નમૂનો\n\n', lang: 'gu' },
        { text: 'Namuno\n\n', lang: 'translit' },
        { text: 'Sample', lang: 'en' },
      ]),
    ]);
    expect(words(languageView(s, ['gu', 'en']))).toEqual(['નમૂનો\n\nSample']);
    expect(words(languageView(s, ['translit']))).toEqual(['Namuno']);
  });

  it('always shows text with no language, and boxes marked for every screen', () => {
    const s = slide([
      box('k', [
        { text: '— 1 —\n', lang: null },
        { text: 'નમૂનો\n', lang: 'gu' },
        { text: 'nmUnO\n', font: 'Gopika', legacy: true, lang: null },
        { text: 'Sample', lang: 'en' },
      ]),
      {
        ...box('title', [{ text: 'Placeholder title', lang: 'en' }], {
          x: 100,
          y: 20,
          width: 1720,
          height: 100,
        }),
        everyScreen: true,
      },
    ]);
    expect(words(languageView(s, ['gu']))).toEqual(['— 1 —\nનમૂનો\nnmUnO', 'Placeholder title']);
  });

  it('takes out a box left empty, and closes up a column of boxes around its middle, in the screen’s order', () => {
    const gu = box('gu', [{ text: 'નમૂનો', lang: 'gu' }], { x: 100, y: 200, width: 1720, height: 200 });
    const tr = box('tr', [{ text: 'Namuno', lang: 'translit' }], {
      x: 100,
      y: 450,
      width: 1720,
      height: 150,
    });
    const en = box('en', [{ text: 'Sample', lang: 'en' }], { x: 100, y: 650, width: 1720, height: 150 });
    const band: SlideElement = {
      id: 'band',
      kind: 'shape',
      frame: { x: 0, y: 180, width: 1920, height: 640 },
      fill: '#000000',
      cornerRadius: 0,
      opacity: 0.5,
    };
    const s = slide([band, gu, tr, en]);
    // The column ran from 200 to 800 (middle 500), with 50 between boxes.
    const two = languageView(s, ['en', 'gu']);
    expect(two.elements.map((e) => [e.id, e.frame.y])).toEqual([
      ['band', 180],
      ['gu', 500 - 400 / 2 + 150 + 50],
      ['en', 500 - 400 / 2],
    ]);
    expect(languageView(s, ['gu', 'translit']).elements.map((e) => [e.id, e.frame.y])).toEqual([
      ['band', 180],
      ['gu', 500 - 400 / 2],
      ['tr', 500 - 400 / 2 + 200 + 50],
    ]);
    // Boxes side by side are not a column: they stay where they are.
    const left = box('l', [{ text: 'નમૂનો', lang: 'gu' }], { x: 0, y: 200, width: 900, height: 600 });
    const right = box('r', [{ text: 'Sample', lang: 'en' }], { x: 1000, y: 200, width: 900, height: 600 });
    expect(
      languageView(slide([left, right]), ['en']).elements.map((e) => [e.id, e.frame.x, e.frame.y]),
    ).toEqual([['r', 1000, 200]]);
  });
});
