import { expect, it } from 'vitest';
import type { DeckNativeTransition } from '../../../shared/deck-transition';
import type { SlideLayer } from '../../../shared/engine/state';
import { nextShowing, slideMediaReady } from './SlideLayerView';

const layer: SlideLayer = {
  presentationId: 'deck',
  slideIndex: 1,
  shownAt: 2000,
  notes: '',
  slide: {
    id: 'incoming',
    width: 1920,
    height: 1080,
    background: null,
    elements: [],
    deck: {
      steps: [],
      media: [],
      motion: { stepsMs: [0, 300], effects: [], approximate: false },
      stepTransitions: { 1: { mode: 'over', transition: { kind: 'dissolve', durationMs: 400 } } },
    },
  },
};

it('cuts to a slide Drashti draws while its hidden video and the one behind a poster are still loading', () => {
  const pending = (deckCover: string) =>
    Object.assign(new EventTarget(), { readyState: 0, dataset: { deckCover } });
  const root = {
    querySelectorAll: (tag: string) => (tag === 'video' ? [pending('hidden'), pending('poster')] : []),
  } as unknown as HTMLElement;
  expect(slideMediaReady(root, 0, layer)).toBe(true);
});

const native: DeckNativeTransition = { kind: 'wipe', durationMs: 600, deckEffect: 'wipe', direction: 'up' };
const incoming = { ...layer, transition: native, step: 0, stepAt: 2600 };

it('keeps the outgoing slide while an early click waits for the incoming transition to finish', () => {
  const previous = { ...layer, slideIndex: 0, slide: { ...layer.slide, id: 'previous' }, shownAt: 1000 };
  const fade = { kind: native.kind, start: layer.shownAt, ms: native.durationMs, native };
  const pressed = { ...incoming, step: 1, stepAt: 2600 };
  const showing = nextShowing({ on: incoming, off: previous, fade }, pressed, 2200);
  expect(showing).toMatchObject({ on: incoming, off: previous, fade });
});

it('shows an edit made while an early click waits for the incoming transition, not the click’s older slide, once it ends', () => {
  const previous = { ...layer, slideIndex: 0, slide: { ...layer.slide, id: 'previous' }, shownAt: 1000 };
  const fade = { kind: native.kind, start: layer.shownAt, ms: native.durationMs, native };
  const pressed = { ...incoming, step: 1, stepAt: 2600 };
  const waiting = nextShowing({ on: incoming, off: previous, fade }, pressed, 2200);
  // Edited during the transition, on the same click (the engine keeps it): still a slide Drashti plays itself, or no
  // longer one (an older deck's slide whose clicks an edit does not keep).
  const edits: [string, SlideLayer][] = [
    ['still one Drashti plays itself', { ...pressed, slide: { ...pressed.slide } }],
    [
      'no longer one Drashti plays itself',
      { ...pressed, slide: { ...pressed.slide, deck: { steps: [], media: [] } } },
    ],
  ];
  for (const [what, edited] of edits) {
    const showing = nextShowing(waiting, edited, 2300);
    // As the transition ends, SlideLayerView puts through the click that waited, if any.
    const done = { on: showing.on, off: null, fade: null };
    const after = showing.afterTransition ? nextShowing(done, showing.afterTransition, 2700) : done;
    expect(after.on, what).toBe(edited);
  }
});
