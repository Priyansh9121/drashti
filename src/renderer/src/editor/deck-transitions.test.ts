import { describe, expect, it } from 'vitest';
import type { DeckSlide } from '../../../shared/deck';
import { deckOwnWords, withSlideTransition, withStepTransition } from './DeckTransitions';

/*
 * A deck's slide's transitions in the slide editor (Session 54, C2): Drashti's own on the slide and on each click,
 * over or instead of the deck's own, set and taken off again, and the deck's own said in words.
 */

const deck: DeckSlide = {
  transition: { name: 'p14:vortex', durationMs: 1500, soundId: 'chime' },
  steps: [
    { clipId: 'c0', clipMs: 2000, transitionMs: 1500, lastId: 'l0' },
    { clipId: 'c1', clipMs: 500, lastId: 'l1' },
    { clipId: 'c2', clipMs: 500, lastId: 'l2' },
  ],
  media: [],
};

describe('a deck’s slide’s transitions in the slide editor (Session 54, C2)', () => {
  it('says the deck’s own in words', () => {
    expect(deckOwnWords(deck)).toBe('Vortex, 1.5 s, with its sound');
    expect(deckOwnWords({ ...deck, transition: { name: 'push', durationMs: 400 } })).toBe('Push, 0.4 s');
    expect(deckOwnWords({ ...deck, transition: undefined })).toBe('None');
  });

  it('sets Drashti’s own on the slide and on a click, over or instead of the deck’s, and takes it off again', () => {
    const over = withSlideTransition(deck, {
      transition: { kind: 'dissolve', durationMs: 800 },
      mode: 'over',
    });
    expect(over.drashti).toEqual({ transition: { kind: 'dissolve', durationMs: 800 }, mode: 'over' });
    expect(withSlideTransition(over, null)).toEqual(deck);
    const click = withStepTransition(deck, 2, {
      transition: { kind: 'slide', durationMs: 600 },
      mode: 'instead',
    });
    expect(click.stepTransitions).toEqual({
      2: { transition: { kind: 'slide', durationMs: 600 }, mode: 'instead' },
    });
    const both = withStepTransition(click, 1, {
      transition: { kind: 'cut', durationMs: 0 },
      mode: 'instead',
    });
    expect(Object.keys(both.stepTransitions ?? {})).toEqual(['1', '2']);
    expect(withStepTransition(withStepTransition(both, 1, null), 2, null)).toEqual(deck);
  });
});
