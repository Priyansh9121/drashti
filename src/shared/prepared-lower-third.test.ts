import { describe, expect, it } from 'vitest';
import type { RenderSlide, TextElement } from './model';
import { checkTranslation, draftTranslation } from './prepared-translations';
import { checkedTranslationView } from './prepared-translation-view';
import { lowerThirdOf } from './program';
const source = 'Source Q1\nSource Q2\nSource Q3\nSource Q4\nSource Q5';
function slide(text: string): RenderSlide {
  const el: TextElement = {
    id: 'e',
    kind: 'text',
    text: source,
    lang: 'en',
    frame: { x: 100, y: 50, width: 1500, height: 600 },
    style: {
      fontFamily: null,
      fontSize: 60,
      fontWeight: 400,
      color: '#ffffff',
      align: 'center',
      verticalAlign: 'top',
      lineHeight: 1.45,
      shadow: false,
    },
    translations: [checkTranslation(draftTranslation(source, 'en', 'gu', text), source, 'Reader Q')],
    translationDisplay: {
      choice: 'gu',
      groups: {},
      outputs: {},
      area: { x: 100, y: 670, width: 1500, height: 150 },
      fontSize: 40,
    },
  };
  return checkedTranslationView({ id: 's', width: 1920, height: 1080, background: null, elements: [el] }, {});
}
describe('prepared translation in a camera lower third', () => {
  it('never cuts a checked translated sentence in half or displaces an original line', () => {
    const shown = lowerThirdOf(slide('Placeholder first\nPlaceholder second'), null);
    expect(shown.lines.map((line) => line.runs.map((run) => run.text).join(''))).toEqual(source.split('\n'));
    expect(shown.total).toBe(7);
  });
  it('adds a whole checked target only when every original line still fits, marking its secondary lines', () => {
    const shown = lowerThirdOf(slide('Placeholder Q7'), null);
    expect(shown.lines).toHaveLength(6);
    expect(shown.lines.slice(0, 5).map((line) => line.runs.map((run) => run.text).join(''))).toEqual(
      source.split('\n'),
    );
    expect(shown.lines[5]).toMatchObject({ lang: 'gu', preparedTranslation: true });
  });
});
