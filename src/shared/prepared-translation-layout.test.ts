import { expect, it } from 'vitest';
import { fitElements } from './slide-size';
import { checkTranslation, draftTranslation } from './prepared-translations';
import type { TextElement } from './model';
it('fits the deliberately reserved translation area with the original when a presentation changes size, keeping linguistic review', () => {
  const el: TextElement = {
    id: 'e',
    kind: 'text',
    text: 'Box Q.',
    lang: 'en',
    frame: { x: 100, y: 100, width: 1500, height: 100 },
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
    translations: [
      checkTranslation(draftTranslation('Box Q.', 'en', 'gu', 'Placeholder Q'), 'Box Q.', 'Reader Q'),
    ],
    translationDisplay: {
      choice: 'gu',
      groups: {},
      outputs: {},
      area: { x: 100, y: 220, width: 1500, height: 150 },
      fontSize: 48,
    },
  };
  const fitted = fitElements([el], { width: 1920, height: 1080 }, { width: 960, height: 540 })[0];
  if (fitted?.kind !== 'text') throw new Error('Missing fitted text');
  expect(fitted.translationDisplay?.area).toEqual({ x: 50, y: 110, width: 750, height: 75 });
  expect(fitted.translationDisplay?.fontSize).toBe(24);
  expect(fitted.translations).toBe(el.translations);
});
