import { describe, expect, it } from 'vitest';
import {
  ENGINE_STATE_VERSION,
  type EngineState,
  initialEngineState,
  LAYER_NAMES,
  type LayerName,
} from '../../shared/engine/state';
import { DEFAULT_LOWER_THIRD_LOOK } from '../../shared/lower-thirds';
import type { EngineAction } from './actions';
import { reduce } from './reducer';
import { deepFreeze, textSlide } from './testing';

const show = (index: number, text = `Slide ${index + 1}`, at = 1000 + index): EngineAction => ({
  type: 'slide/show',
  presentationId: 'p1',
  slideIndex: index,
  slideCount: 3,
  slide: textSlide(`s${index}`, text),
  arrangementId: null,
  playlist: null,
  notes: '',
  at,
});

/** A state with every layer populated. */
function fullState(): EngineState {
  let s = initialEngineState();
  const actions: EngineAction[] = [
    show(1),
    {
      type: 'audio/set',
      audio: { id: 'a1', title: 'Dhun', mediaId: null, volume: 1, loop: false, startedAt: 1 },
    },
    { type: 'background/set', background: { kind: 'color', color: '#112233' } },
    { type: 'message/show', message: { id: 'm1', text: 'Car please move' } },
    { type: 'ticker/show', item: { id: 't1', text: 'Placeholder ticker words' }, at: 5 },
    {
      type: 'lowerThird/show',
      layer: {
        id: 'lt1',
        lines: ['Placeholder name', 'Placeholder title'],
        look: DEFAULT_LOWER_THIRD_LOOK,
        where: 'both',
        animation: 'fade-steady',
        shownAt: 6,
      },
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
    expect(s.live).toEqual({
      presentationId: null,
      slideIndex: null,
      slideCount: 0,
      arrangementId: null,
      playlist: null,
    });
    for (const layer of LAYER_NAMES)
      expect(s.layers[layer] === null || Array.isArray(s.layers[layer])).toBe(true);
    expect(s.blackout).toBe(false);
  });

  describe('slide/show', () => {
    it('sets the cursor and the slide layer', () => {
      const s = reduce(deepFreeze(initialEngineState()), show(0));
      expect(s.live).toEqual({
        presentationId: 'p1',
        slideIndex: 0,
        slideCount: 3,
        arrangementId: null,
        playlist: null,
      });
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
      expect(next.layers.messages).toBe(s.layers.messages);
      expect(next.layers.audio).toBe(s.layers.audio);
      expect(next.blackout).toBe(true);
    });
  });

  describe('the slide taken off on its own (Session 27)', () => {
    it('is kept with its time when the slide layer is cleared, and goes when Clear all or another slide comes', () => {
      const s = fullState();
      const off = reduce(s, { type: 'layer/clear', layer: 'slide', at: 9000 });
      expect(off.layers.slide).toBeNull();
      expect(off.slideOff).toEqual({ layer: s.layers.slide, at: 9000 });
      // Clear all: everything at once, nothing fading.
      expect(reduce(s, { type: 'layers/clearAll' }).slideOff).toBeNull();
      expect(reduce(off, { type: 'layers/clearAll' }).slideOff).toBeNull();
      // Another slide up: nothing leaving any more.
      expect(reduce(off, show(1, undefined, 9500)).slideOff).toBeNull();
      // Another layer cleared, or the slide cleared with no time given: no slide taken off.
      expect(reduce(s, { type: 'layer/clear', layer: 'messages', at: 9000 }).slideOff).toBeNull();
      expect(reduce(s, { type: 'layer/clear', layer: 'slide' }).slideOff).toBeNull();
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
      expect(next.live).toEqual({
        presentationId: 'p1',
        slideIndex: 1,
        slideCount: 3,
        arrangementId: null,
        playlist: null,
      });
    });
  });

  describe('layers/clearAll', () => {
    it('empties every layer but keeps the cursor and black-out', () => {
      const s = fullState();
      const next = reduce(s, { type: 'layers/clearAll' });
      expect(s.layers.lowerThird?.id).toBe('lt1');
      expect(next.layers).toEqual({
        audio: null,
        background: null,
        slide: null,
        messages: [],
        ticker: null,
        pip: null,
        lowerThird: null,
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
      expect(next.layers.messages).toBe(s.layers.messages);
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
    const audio = { id: 'a', title: 'Arti', mediaId: 'm', volume: 0.5, loop: true, startedAt: 7 };
    const cases: [string, EngineAction, (s: EngineState) => unknown, unknown][] = [
      ['background', { type: 'background/set', background }, (s) => s.layers.background, background],
      ['audio', { type: 'audio/set', audio }, (s) => s.layers.audio, audio],
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

  describe('messages', () => {
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

  describe('a message’s time on the screens (Session 27)', () => {
    it('is when it went up, and an update keeps it, so the entrance never plays again', () => {
      let s = reduce(deepFreeze(initialEngineState()), {
        type: 'message/show',
        message: { id: 'm', text: 'Placeholder one' },
        at: 5000,
      });
      expect(s.layers.messages).toEqual([{ id: 'm', text: 'Placeholder one', shownAt: 5000 }]);
      s = reduce(deepFreeze(s), {
        type: 'message/show',
        message: { id: 'm', text: 'Placeholder two' },
        at: 9000,
      });
      expect(s.layers.messages).toEqual([{ id: 'm', text: 'Placeholder two', shownAt: 5000 }]);
      // Another comes in from its own time; hidden and shown again, it comes in again.
      s = reduce(deepFreeze(s), {
        type: 'message/show',
        message: { id: 'n', text: 'Placeholder three' },
        at: 9500,
      });
      expect(s.layers.messages.map((m) => m.shownAt)).toEqual([5000, 9500]);
      s = reduce(reduce(s, { type: 'message/hide', messageId: 'm' }), {
        type: 'message/show',
        message: { id: 'm', text: 'Placeholder two' },
        at: 12_000,
      });
      expect(s.layers.messages.find((m) => m.id === 'm')?.shownAt).toBe(12_000);
      // Put back from a saved state, it keeps the time it had; with none, it has none (still, no entrance).
      const kept = reduce(initialEngineState(), {
        type: 'message/show',
        message: { id: 'k', text: 'K', shownAt: 100 },
      });
      expect(kept.layers.messages[0]?.shownAt).toBe(100);
      expect(
        reduce(initialEngineState(), { type: 'message/show', message: { id: 'k', text: 'K' } }).layers
          .messages[0],
      ).toEqual({ id: 'k', text: 'K' });
    });
  });

  describe('the Wallpaper (Session 55, in the Logo’s place)', () => {
    it('goes up and off, covering the layers without changing them; the same again changes nothing', () => {
      const s = deepFreeze(fullState());
      const up = reduce(s, { type: 'wallpaper/set', on: true });
      expect(up.wallpaper).toBe(true);
      expect(up.layers).toBe(s.layers);
      expect(reduce(deepFreeze(up), { type: 'wallpaper/set', on: true })).toBe(up);
      expect(reduce(deepFreeze(up), { type: 'wallpaper/set', on: false }).wallpaper).toBe(false);
      // Clear all leaves it as it is.
      expect(reduce(deepFreeze(up), { type: 'layers/clearAll' }).wallpaper).toBe(true);
    });
  });

  describe('the ticker', () => {
    it('starts again from the right each time an announcement joins, changes or leaves', () => {
      let s = reduce(deepFreeze(initialEngineState()), {
        type: 'ticker/show',
        item: { id: 'a', text: 'One' },
        at: 100,
      });
      // The band's own time is when it came up (its entrance plays once, Session 27); the words start again.
      expect(s.layers.ticker).toEqual({ items: [{ id: 'a', text: 'One' }], startedAt: 100, shownAt: 100 });
      s = reduce(deepFreeze(s), { type: 'ticker/show', item: { id: 'b', text: 'Two' }, at: 200 });
      expect(s.layers.ticker).toEqual({
        items: [
          { id: 'a', text: 'One' },
          { id: 'b', text: 'Two' },
        ],
        startedAt: 200,
        shownAt: 100,
      });
      const same = deepFreeze(s);
      // The same words again change nothing, and the ticker carries on where it is.
      expect(reduce(same, { type: 'ticker/show', item: { id: 'b', text: 'Two' }, at: 300 })).toBe(same);
      expect(reduce(same, { type: 'ticker/hide', itemId: 'missing', at: 300 })).toBe(same);
      s = reduce(same, { type: 'ticker/hide', itemId: 'a', at: 300 });
      expect(s.layers.ticker).toEqual({ items: [{ id: 'b', text: 'Two' }], startedAt: 300, shownAt: 100 });
      expect(reduce(deepFreeze(s), { type: 'ticker/hide', itemId: 'b', at: 400 }).layers.ticker).toBeNull();
    });

    it('is put back as it was (restart recovery), carrying on from when it started', () => {
      const ticker = { items: [{ id: 'a', text: 'One' }], startedAt: 50 };
      const s = reduce(deepFreeze(initialEngineState()), { type: 'ticker/set', ticker });
      expect(s.layers.ticker).toEqual(ticker);
      expect(reduce(deepFreeze(s), { type: 'ticker/set', ticker: { ...ticker } })).toBe(s);
    });
  });
});
