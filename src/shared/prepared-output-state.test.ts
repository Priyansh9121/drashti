import { describe, expect, it } from 'vitest';
import { emptyState } from './engine/state';
import { preparedOutputState } from './prepared-output-state';
import { checkTranslation, draftTranslation } from './prepared-translations';
import type { RenderSlide } from './model';
const slide = (): RenderSlide => ({ id: 's', width: 1920, height: 1080, background: null, elements: [{ id: 'e', kind: 'text', text: 'Blue box.', lang: 'en', frame: { x: 100, y: 100, width: 1500, height: 100 }, style: { fontFamily: null, fontSize: 60, fontWeight: 400, color: '#ffffff', align: 'center', verticalAlign: 'top', lineHeight: 1.45, shadow: false }, translations: [checkTranslation(draftTranslation('Blue box.', 'en', 'gu', 'Placeholder Q'), 'Blue box.', 'Reader Q')], translationDisplay: { choice: 'gu', groups: {}, outputs: { second: 'off' }, area: { x: 100, y: 220, width: 1500, height: 150 }, fontSize: 48 } }] });
describe('prepared output state', () => {
  it('draws selected checked words for current and next, keeps source state immutable and reuses slides on clock updates', () => {
    const state = emptyState();
    state.next = { kind: 'slide', presentationId: 'p', slideIndex: 0, slide: slide(), label: 'Placeholder', notes: '', cues: [] };
    const shown = preparedOutputState(state, {});
    if (shown.next?.kind !== 'slide' || state.next.kind !== 'slide') throw new Error('Missing fixture next');
    expect(shown.next.slide.elements).toHaveLength(2);
    expect(state.next.slide.elements).toHaveLength(1);
    const tick = preparedOutputState({ ...state }, {});
    if (tick.next?.kind !== 'slide') throw new Error('Missing next');
    expect(tick.next.slide).toBe(shown.next.slide);
    const off = preparedOutputState(state, { outputId: 'second' });
    if (off.next?.kind !== 'slide') throw new Error('Missing next');
    expect(off.next.slide.elements).toHaveLength(1);
  });
});
