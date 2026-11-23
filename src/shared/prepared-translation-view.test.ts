import { describe, expect, it } from 'vitest';
import { cropRenderedPage } from './pdf-page-crop';
import { languageView } from './language-view';
import type { RenderSlide, TextElement } from './model';
import {
  checkedTranslationView,
  translationChoiceFor,
  translationFits,
  playbackTranslationSlide,
} from './prepared-translation-view';
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
    el.translations = [
      checkTranslation(draftTranslation('Blue box.', 'en', 'gu', 'કિ કી કું'), 'Blue box.', 'Reader Q'),
    ];
    expect(checkedTranslationView(slide(el), {}).elements[1]).toMatchObject({ text: 'કિ કી કું' });
  });
  it('never relies on breaking a long word, never inherits vertical source styling, and holds invisible sources', () => {
    expect(translationFits('Q'.repeat(20), { x: 0, y: 0, width: 1500, height: 150 }, 48)).toBe(false);
    const el = box();
    el.style.writingMode = 'vertical-rl';
    const shown = checkedTranslationView(slide(el), {});
    expect(shown.elements[1]).toMatchObject({
      kind: 'text',
      style: { fontFamily: null, fontSize: 48, lineHeight: 1.45 },
    });
    const translation = shown.elements[1];
    if (translation?.kind !== 'text') throw new Error('Missing translation');
    expect(translation.style.writingMode).toBeUndefined();
    el.opacity = 0;
    expect(checkedTranslationView(slide(el), {}).elements).toHaveLength(1);
  });
  it('keeps the source above its translation even when a kirtan group filters source language out', () => {
    const shown = languageView(checkedTranslationView({ ...slide(), kirtan: true }, {}), ['gu']);
    expect(shown.elements.map((el) => (el.kind === 'text' ? el.text : ''))).toEqual([
      'Blue box.',
      'Placeholder Q',
    ]);
  });
  it('reuses the sanitized playback slide across reads', () => {
    const original = slide();
    expect(playbackTranslationSlide(original)).toBe(playbackTranslationSlide(original));
  });
  it('holds secondary words cropped by a fill canvas or too small on a narrow output', () => {
    const original = slide();
    const fill = { groupId: 'hall', canvas: { width: 1024, height: 768 }, scaling: 'fill' as const };
    const fit = { groupId: 'hall', canvas: { width: 1024, height: 768 }, scaling: 'fit' as const };
    const narrow = { groupId: 'hall', canvas: { width: 360, height: 1080 }, scaling: 'fit' as const };
    expect(checkedTranslationView(original, fill).elements).toEqual(original.elements);
    expect(checkedTranslationView(original, fit).elements).toHaveLength(2);
    expect(checkedTranslationView(original, narrow).elements).toEqual(original.elements);
  });
  it('keeps original kirtan words when a selected saved target is missing or still unchecked', () => {
    const original = { ...slide(), kirtan: true };
    const missing = languageView(checkedTranslationView(original, { groupId: 'stage' }), ['hi']);
    expect(missing.elements.map((el) => (el.kind === 'text' ? el.text : ''))).toEqual(['Blue box.']);
    const el = box();
    el.translations = [draftTranslation('Blue box.', 'en', 'gu', 'Placeholder unchecked')];
    const publicSlide = playbackTranslationSlide({ ...slide(el), kirtan: true });
    expect(JSON.stringify(publicSlide)).not.toContain('Placeholder unchecked');
    const draft = languageView(checkedTranslationView(publicSlide, {}), ['gu']);
    expect(draft.elements.map((value) => (value.kind === 'text' ? value.text : ''))).toEqual(['Blue box.']);
  });
  it('matches the app’s NFC source form after save while still holding a changed word', () => {
    const source = 'Cafe\u0301 box.';
    const canonical = source.normalize('NFC');
    const el = box();
    el.text = canonical;
    el.translations = [
      checkTranslation(draftTranslation(source, 'en', 'gu', 'Placeholder Q7'), canonical, 'Reader Q'),
    ];
    expect(checkedTranslationView(slide(el), {}).elements[1]).toMatchObject({ text: 'Placeholder Q7' });
    el.text = 'Cafe box.';
    expect(checkedTranslationView(slide(el), {}).elements).toHaveLength(1);
  });
  it('does not let authored-language column reflow move a source/translation pair', () => {
    const el = box();
    const other = {
      ...box(),
      id: 'authored-hi',
      text: 'Placeholder authored Hindi',
      lang: 'hi' as const,
      frame: { x: 100, y: 600, width: 1500, height: 120 },
    };
    delete other.translations;
    delete other.translationDisplay;
    const original = { ...slide(el), kirtan: true, elements: [el, other] };
    const shown = languageView(checkedTranslationView(original, {}), ['gu']);
    expect(shown.elements.find((value) => value.id === el.id)?.frame).toEqual(el.frame);
    expect(shown.elements.find((value) => value.id === `${el.id}:translation:gu`)?.frame).toEqual(
      el.translationDisplay?.area,
    );
  });
});

describe('checked translations on cropped PDF pages', () => {
  const cropped = (x = 600) => {
    const el = box();
    el.frame = { x: 600, y: 200, width: 600, height: 120 };
    if (!el.translationDisplay) throw new Error('Generated translation display missing');
    el.translationDisplay.area = { x, y: 340, width: 600, height: 150 };
    el.translationDisplay.fontSize = 24;
    expect(translationFits('Placeholder Q', el.translationDisplay.area, 24)).toBe(true);
    return cropRenderedPage(slide(el), { x: 0.25, y: 0.1, w: 0.5, h: 0.6 });
  };
  it('retains checked words inside the crop using their original page coordinates', () => {
    const shown = checkedTranslationView(cropped(), { canvas: { width: 1920, height: 1080 } });
    expect(shown.elements).toHaveLength(2);
    expect(shown.elements[1]?.frame).toEqual({ x: 600, y: 340, width: 600, height: 150 });
    expect(shown.pageCrop).toEqual({ x: 480, y: 108, width: 1920, height: 1080 });
  });
  it('holds translations that the page crop would cut off', () => {
    expect(
      checkedTranslationView(cropped(300), { canvas: { width: 1920, height: 1080 } }).elements,
    ).toHaveLength(1);
  });
});
