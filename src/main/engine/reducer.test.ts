import { describe, expect, it } from 'vitest';
import {
  ENGINE_STATE_VERSION,
  type EngineState,
  initialEngineState,
  LAYER_NAMES,
  type LayerName,
} from '../../shared/engine/state';
import type { EngineAction } from './actions';
import { reduce } from './reducer';
import { deepFreeze, textSlide } from './testing';

const show = (index: number, text = `Slide ${index + 1}`, at = 1000 + index): EngineAction => ({
  type: 'slide/show',
  presentationId: 'p1',
  slideIndex: index,
  slideCount: 3,
  slide: textSlide(`s${index}`, text),
  at,
});

/** A state with every layer populated. */
function fullState(): EngineState {
  let s = initialEngineState();
  const actions: EngineAction[] = [
    show(1),
    { type: 'audio/set', audio: { id: 'a1', title: 'Dhun', mediaId: null } },
    { type: 'background/set', background: { kind: 'color', color: '#112233' } },
    { type: 'prop/show', prop: { id: 'logo', name: 'Logo', elements: [] } },
    { type: 'message/show', message: { id: 'm1', text: 'Car please move' } },
    {
      type: 'mask/set',
      mask: { id: 'mask', name: 'Centre', visible: { x: 10, y: 10, width: 100, height: 100 } },
    },
    { type: 'blackout/set', on: true },
  ];
  for (const a of actions) s = reduce(s, a);
  return deepFreeze(s);
}

describe('reduce', () => {
  it('starts empty', () => {
    const s = initialEngineState();
    expect(s.version).toBe(ENGINE_STATE_VERSION);
    expect(s.live).toEqual({ presentationId: null, slideIndex: null, slideCount: 0 });
    for (const layer of LAYER_NAMES)
      expect(s.layers[layer] === null || Array.isArray(s.layers[layer])).toBe(true);
    expect(s.blackout).toBe(false);
  });

  describe('slide/show', () => {
    it('sets the cursor and the slide layer', () => {
      const s = reduce(deepFreeze(initialEngineState()), show(0));
      expect(s.live).toEqual({ presentationId: 'p1', slideIndex: 0, slideCount: 3 });
      expect(s.layers.slide?.slideIndex).toBe(0);
      expect(s.layers.slide?.slide.id).toBe('s0');
    });

    it('returns the same state for the same slide', () => {
      const s = deepFreeze(reduce(initialEngineState(), show(0)));
      expect(reduce(s, show(0))).toBe(s);
    });

    it('updates only the slide layer when the content of the live slide changed', () => {
      const s = deepFreeze(reduce(initialEngineState(), show(0)));
      const next = reduce(s, show(0, 'Edited', 5000));
      expect(next.live).toBe(s.live);
      expect(next.layers.slide?.slide.elements[0]).toMatchObject({ text: 'Edited' });
      // Still the same slide on screen: its videos carry on.
      expect(next.layers.slide?.shownAt).toBe(1000);
    });

    it('records when each slide went live, again after the slide layer was cleared', () => {
      let s = reduce(initialEngineState(), show(0, undefined, 1000));
      expect(s.layers.slide?.shownAt).toBe(1000);
      s = reduce(s, show(1, undefined, 2000));
      expect(s.layers.slide?.shownAt).toBe(2000);
      s = reduce(s, show(1, undefined, 3000));
      expect(s.layers.slide?.shownAt).toBe(2000);
      s = reduce(reduce(s, { type: 'layer/clear', layer: 'slide' }), show(1, undefined, 4000));
      expect(s.layers.slide?.shownAt).toBe(4000);
    });

    it('leaves the other layers untouched', () => {
      const s = fullState();
      const next = reduce(s, show(2));
      expect(next.layers.props).toBe(s.layers.props);
      expect(next.layers.audio).toBe(s.layers.audio);
      expect(next.blackout).toBe(true);
    });
  });

  describe('layer/clear', () => {
    it.each(LAYER_NAMES)('clears the %s layer and nothing else', (layer: LayerName) => {
      const s = fullState();
      const next = reduce(s, { type: 'layer/clear', layer });
      const cleared = next.layers[layer];
      expect(Array.isArray(cleared) ? cleared.length : cleared).toBe(Array.isArray(cleared) ? 0 : null);
      for (const other of LAYER_NAMES) if (other !== layer) expect(next.layers[other]).toBe(s.layers[other]);
      expect(next.live).toBe(s.live);
      expect(next.blackout).toBe(true);
    });

    it.each(LAYER_NAMES)('does nothing when the %s layer is already empty', (layer: LayerName) => {
      const s = deepFreeze(initialEngineState());
      expect(reduce(s, { type: 'layer/clear', layer })).toBe(s);
    });

    it('keeps the cursor when the slide is cleared', () => {
      const next = reduce(fullState(), { type: 'layer/clear', layer: 'slide' });
      expect(next.live).toEqual({ presentationId: 'p1', slideIndex: 1, slideCount: 3 });
    });
  });

  describe('layers/clearAll', () => {
    it('empties every layer but keeps the cursor and black-out', () => {
      const s = fullState();
      const next = reduce(s, { type: 'layers/clearAll' });
      expect(next.layers).toEqual({
        audio: null,
        background: null,
        slide: null,
        props: [],
        messages: [],
        masks: null,
      });
      expect(next.live).toBe(s.live);
      expect(next.blackout).toBe(true);
    });

    it('does nothing when everything is already empty', () => {
      const s = deepFreeze(initialEngineState());
      expect(reduce(s, { type: 'layers/clearAll' })).toBe(s);
    });

    it('only replaces the layers that had something', () => {
      const s = deepFreeze(reduce(initialEngineState(), show(0)));
      const next = reduce(s, { type: 'layers/clearAll' });
      expect(next.layers.props).toBe(s.layers.props);
      expect(next.layers.slide).toBeNull();
    });
  });

  describe('blackout/set', () => {
    it('turns black-out on and off', () => {
      const on = reduce(deepFreeze(initialEngineState()), { type: 'blackout/set', on: true });
      expect(on.blackout).toBe(true);
      expect(reduce(deepFreeze(on), { type: 'blackout/set', on: false }).blackout).toBe(false);
    });

    it('does nothing when already in that state', () => {
      const s = deepFreeze(initialEngineState());
      expect(reduce(s, { type: 'blackout/set', on: false })).toBe(s);
    });
  });

  describe('single-value layers', () => {
    const background = { kind: 'color', color: '#abcdef' } as const;
    const audio = { id: 'a', title: 'Arti', mediaId: 'm' };
    const mask = { id: 'k', name: 'k', visible: { x: 0, y: 0, width: 1, height: 1 } };
    const cases: [string, EngineAction, (s: EngineState) => unknown, unknown][] = [
      ['background', { type: 'background/set', background }, (s) => s.layers.background, background],
      ['audio', { type: 'audio/set', audio }, (s) => s.layers.audio, audio],
      ['masks', { type: 'mask/set', mask }, (s) => s.layers.masks, mask],
    ];
    it.each(cases)(
      'sets the %s layer, and setting it again changes nothing',
      (_name, action, pick, expected) => {
        const s = reduce(deepFreeze(initialEngineState()), action);
        expect(pick(s)).toEqual(expected);
        expect(reduce(deepFreeze(s), action)).toBe(s);
      },
    );
  });

  describe('props and messages', () => {
    it('shows, replaces and hides props by id', () => {
      let s = reduce(deepFreeze(initialEngineState()), {
        type: 'prop/show',
        prop: { id: 'p', name: 'A', elements: [] },
      });
      s = reduce(deepFreeze(s), { type: 'prop/show', prop: { id: 'q', name: 'B', elements: [] } });
      s = reduce(deepFreeze(s), { type: 'prop/show', prop: { id: 'p', name: 'A2', elements: [] } });
      expect(s.layers.props.map((p) => `${p.id}:${p.name}`)).toEqual(['p:A2', 'q:B']);
      const same = deepFreeze(s);
      expect(reduce(same, { type: 'prop/show', prop: { id: 'p', name: 'A2', elements: [] } })).toBe(same);
      expect(reduce(same, { type: 'prop/hide', propId: 'missing' })).toBe(same);
      expect(reduce(same, { type: 'prop/hide', propId: 'p' }).layers.props.map((p) => p.id)).toEqual(['q']);
    });

    it('shows, replaces and hides messages by id', () => {
      let s = reduce(deepFreeze(initialEngineState()), {
        type: 'message/show',
        message: { id: 'm', text: 'One' },
      });
      s = reduce(deepFreeze(s), { type: 'message/show', message: { id: 'm', text: 'Two' } });
      expect(s.layers.messages).toEqual([{ id: 'm', text: 'Two' }]);
      const same = deepFreeze(s);
      expect(reduce(same, { type: 'message/show', message: { id: 'm', text: 'Two' } })).toBe(same);
      expect(reduce(same, { type: 'message/hide', messageId: 'x' })).toBe(same);
      expect(reduce(same, { type: 'message/hide', messageId: 'm' }).layers.messages).toEqual([]);
    });
  });
});
