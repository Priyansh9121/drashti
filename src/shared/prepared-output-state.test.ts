import { describe, expect, it } from 'vitest';
import { languageView } from './language-view';
import { initialEngineState } from './engine/state';
import { preparedOutputState, translationTop, translationBottom } from './prepared-output-state';
import { checkTranslation, draftTranslation } from './prepared-translations';
import type { RenderSlide } from './model';
const slide = (): RenderSlide => ({
  id: 's',
  width: 1920,
  height: 1080,
  background: null,
  elements: [
    {
      id: 'e',
      kind: 'text',
      text: 'Blue box.',
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
        checkTranslation(draftTranslation('Blue box.', 'en', 'gu', 'Placeholder Q'), 'Blue box.', 'Reader Q'),
      ],
      translationDisplay: {
        choice: 'gu',
        groups: {},
        outputs: { second: 'off' },
        area: { x: 100, y: 220, width: 1500, height: 150 },
        fontSize: 48,
      },
    },
  ],
});
describe('prepared output state', () => {
  it('draws selected checked words for current and next, keeps source state immutable and reuses slides on clock updates', () => {
    const state = initialEngineState();
    state.next = {
      kind: 'slide',
      presentationId: 'p',
      slideIndex: 0,
      slide: slide(),
      background: null,
      itemId: null,
      notes: '',
    };
    const shown = preparedOutputState(state, {});
    expect(state.next.kind).toBe('slide');
    if (shown.next?.kind !== 'slide') throw new Error('Missing fixture next');
    expect(shown.next.slide.elements).toHaveLength(2);
    expect(state.next.slide.elements).toHaveLength(1);
    const tick = preparedOutputState({ ...state }, {});
    if (tick.next?.kind !== 'slide') throw new Error('Missing next');
    expect(tick.next.slide).toBe(shown.next.slide);
    const off = preparedOutputState(state, { outputId: 'second' });
    if (off.next?.kind !== 'slide') throw new Error('Missing next');
    expect(off.next.slide.elements).toHaveLength(1);
  });
  it('removes a projected translation when another output explicitly chooses Off', () => {
    const state = initialEngineState();
    state.next = {
      kind: 'slide',
      presentationId: 'p',
      slideIndex: 0,
      slide: slide(),
      background: null,
      itemId: null,
      notes: '',
    };
    const shown = preparedOutputState(state, {});
    const off = preparedOutputState(shown, { outputId: 'second' });
    if (off.next?.kind !== 'slide') throw new Error('Missing next');
    expect(off.next.slide.elements).toHaveLength(1);
  });
  it('global Hide translation removes a previously projected target while leaving the source alone', () => {
    const state = initialEngineState();
    state.next = {
      kind: 'slide',
      presentationId: 'p',
      slideIndex: 0,
      slide: slide(),
      background: null,
      itemId: null,
      notes: '',
    };
    const projected = preparedOutputState(state, {});
    const result = preparedOutputState(Object.assign({}, projected, { translationHidden: true }), {});
    if (result.next?.kind !== 'slide') throw new Error('Missing next');
    expect(result.next.slide.elements).toHaveLength(1);
    expect(result.next.slide.elements[0]).toBe(state.next.slide.elements[0]);
  });
  it('reserves top captions only on the outputs that actually show them', () => {
    const state = initialEngineState();
    state.captions = {
      lines: ['Placeholder heard Q7'],
      language: 'en',
      audience: false,
      size: 'small',
      place: 'top',
    };
    expect(translationTop(state, 1080, 'hall')).toBe(0);
    expect(translationTop(state, 1080, 'stage')).toBe(324);
    expect(translationTop(state, 1080, 'stream')).toBe(324);
  });
  it('does not reserve a bottom caption band for a top caption or a hall that does not show captions', () => {
    const state = initialEngineState();
    state.captions = {
      lines: ['Placeholder heard Q7'],
      language: 'en',
      audience: false,
      size: 'small',
      place: 'bottom',
    };
    expect(translationBottom(state, 1080, 'hall')).toBe(1080);
    state.captions.place = 'top';
    expect(translationBottom(state, 1080, 'stream')).toBe(1080);
  });
  it('Hide translation keeps the original on a kirtan output that selects only the target language', () => {
    const state = initialEngineState();
    state.next = {
      kind: 'slide',
      presentationId: 'p',
      slideIndex: 0,
      slide: { ...slide(), kirtan: true },
      background: null,
      itemId: null,
      notes: '',
    };
    const hidden = preparedOutputState(Object.assign({}, state, { translationHidden: true }), {});
    if (hidden.next?.kind !== 'slide') throw new Error('Missing next');
    expect(
      languageView(hidden.next.slide, ['gu']).elements.map((el) => (el.kind === 'text' ? el.text : '')),
    ).toEqual(['Blue box.']);
  });
});
