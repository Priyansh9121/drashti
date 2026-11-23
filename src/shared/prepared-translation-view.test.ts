import { describe, expect, it } from 'vitest';
import type { RenderSlide, TextElement } from './model';
import { checkedTranslationView, translationChoiceFor } from './prepared-translation-view';
import { checkTranslation, draftTranslation } from './prepared-translations';
const box = (): TextElement => ({
  id: 'q',
  kind: 'text',
  text: 'Blue box.',
  lang: 'en',
  frame: { x: 100, y: 100, width: 1500, height: 120 },
  style: {
    fontFamily: null,
    fontSize: 60,
    fontWeight: 400,
    color: '#ffffff',
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.45,
    shadow: false,
  },
  translations: [
    checkTranslation(draftTranslation('Blue box.', 'en', 'gu', 'Placeholder Q'), 'Blue box.', 'Reader Q'),
  ],
  translationDisplay: {
    choice: 'gu',
    groups: { stage: 'hi' },
    outputs: { second: 'off' },
    area: { x: 100, y: 240, width: 1500, height: 150 },
    fontSize: 48,
  },
});
const slide = (el = box()): RenderSlide => ({
  id: 's',
  width: 1920,
  height: 1080,
  background: null,
  elements: [el],
});
describe('checked saved translation output', () => {
  it('resolves explicit output Off before group and presentation choices', () => {
    const display = box().translationDisplay;
    expect(translationChoiceFor(display, 'stage', 'second')).toBe('off');
    expect(translationChoiceFor(display, 'stage', 'first')).toBe('hi');
    expect(translationChoiceFor(display, 'hall', 'first')).toBe('gu');
    expect(translationChoiceFor(undefined, 'hall', 'first')).toBe('off');
  });
  it('keeps the original untouched and adds only matching checked text in its reserved area', () => {
    const original = slide();
    const shown = checkedTranslationView(original, { groupId: 'hall', outputId: 'first' });
    expect(shown.elements[0]).toBe(original.elements[0]);
    expect(shown.elements[1]).toMatchObject({
      kind: 'text',
      text: 'Placeholder Q',
      lang: 'gu',
      frame: { x: 100, y: 240, width: 1500, height: 150 },
      style: { lineHeight: 1.45, shrinkToFit: false },
    });
    expect(checkedTranslationView(original, { outputId: 'second' }).elements).toHaveLength(1);
    expect(checkedTranslationView(original, { groupId: 'stage' }).elements).toHaveLength(1);
  });
  it('holds draft, stale, blank, unfit, overlapping and off-canvas words without shrinking the source', () => {
    for (const change of [
      (el: TextElement) => {
        el.text = 'Green box.';
      },
      (el: TextElement) => {
        const value = el.translations?.[0];
        if (value) value.state = 'unchecked';
      },
      (el: TextElement) => {
        const value = el.translations?.[0];
        if (value) value.text = '';
      },
      (el: TextElement) => {
        const value = el.translations?.[0];
        if (value) value.text = 'Long '.repeat(300);
      },
      (el: TextElement) => {
        if (el.translationDisplay) el.translationDisplay.area.y = 110;
      },
      (el: TextElement) => {
        if (el.translationDisplay) el.translationDisplay.area.y = 1050;
      },
    ]) {
      const el = box();
      change(el);
      const original = slide(el);
      expect(checkedTranslationView(original, {}).elements).toEqual(original.elements);
    }
    expect(checkedTranslationView(slide(), { blockedBelow: 200 }).elements).toHaveLength(1);
  });
  it('uses actual run words, refuses mixed languages, and preserves Gujarati and Hindi marks whole', () => {
    const el = box();
    el.runs = [{ text: 'Other run words.', lang: 'en' }];
    expect(checkedTranslationView(slide(el), {}).elements).toHaveLength(1);
    el.runs = [
      { text: 'Blue ', lang: 'en' },
      { text: 'box.', lang: 'hi' },
    ];
    expect(checkedTranslationView(slide(el), {}).elements).toHaveLength(1);
    delete el.runs;
    const value = el.translations?.[0];
    if (!value) throw new Error('Missing fixture translation');
    value.text = 'કિ કી કું';
    expect(checkedTranslationView(slide(el), {}).elements[1]).toMatchObject({ text: 'કિ કી કું' });
  });
});
