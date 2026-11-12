import { expect, it } from 'vitest';
import type { DeckNativeTransition } from '../../shared/deck-transition';
import type { SlideLayer } from '../../shared/engine/state';
import { stepForward } from './deck-steps';

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
      media: [
        {
          kind: 'video',
          mediaId: 'placeholder-video',
          box: { x: 0, y: 0, w: 1, h: 1 },
          loop: false,
          volume: 0,
          start: { step: 1, offsetMs: 50 },
        },
      ],
      motion: { stepsMs: [0, 300], effects: [], approximate: false },
      stepTransitions: { 1: { mode: 'over', transition: { kind: 'dissolve', durationMs: 400 } } },
    },
  },
};

const native: DeckNativeTransition = { kind: 'wipe', durationMs: 600, deckEffect: 'wipe', direction: 'up' };
const incoming = { ...layer, transition: native, step: 0, stepAt: 2600 };

it('starts the click and its embedded media after the incoming PowerPoint transition', () => {
  const pressed = stepForward(incoming, 2200);
  expect(pressed).toMatchObject({ step: 1, stepAt: 2600, seeks: { 'placeholder-video': { at: 2650 } } });
  expect(stepForward(incoming, 2800)).toMatchObject({ step: 1, stepAt: 2800 });
});
