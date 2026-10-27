import { describe, expect, it } from 'vitest';
import type { DeckSlide } from '../../../../shared/deck';
import { type EngineState, initialEngineState } from '../../../../shared/engine/state';
import type { OrderedSlide } from '../../../../shared/order';
import { presentationPages, slidePages } from './pages';

/*
 * A deck looked through on a phone (Session 54, D1/D2 review): one page for each of a deck slide's steps, in order,
 * so Next and Previous go click by click as the deck does; the viewer opened at the step on the screens; and only
 * that step live, with the screens' zoom offered. Made-up ids and placeholder names only.
 */

const DECK: DeckSlide = {
  steps: [
    { clipId: 'clip-0', clipMs: 1000, lastId: 'last-0' },
    { clipId: 'clip-1', clipMs: 1000, lastId: 'last-1' },
    { clipId: 'clip-2', clipMs: 1000, lastId: 'last-2' },
  ],
  media: [],
};

/** A slide at its place in the order: the deck's (its picture its last step's last frame), or one of words. */
function ordered(position: number, deck: boolean): OrderedSlide {
  const id = `slide-${String(position)}`;
  return {
    position,
    group: { id: 'group', name: 'Placeholder group', color: null },
    occurrence: 0,
    slide: {
      id,
      index: position,
      label: '',
      notes: '',
      cues: [],
      transition: null,
      autoAdvanceMs: null,
      macroId: null,
      slide: {
        id,
        width: 1920,
        height: 1080,
        background: null,
        elements: deck
          ? [
              {
                id: `picture-${String(position)}`,
                kind: 'image',
                mediaId: 'last-2',
                fit: 'fit',
                frame: { x: 0, y: 0, width: 1920, height: 1080 },
              },
            ]
          : [],
        ...(deck ? { deck: DECK } : {}),
      },
    },
  };
}

/** The deck's slide on the screens at a step. */
function up(step: number): EngineState {
  const state = initialEngineState();
  const s = ordered(0, true);
  return {
    ...state,
    layers: {
      ...state.layers,
      slide: { presentationId: 'deck', slideIndex: 0, slide: s.slide.slide, shownAt: 5000, notes: '', step },
    },
  };
}

describe('a deck looked through on a phone (Session 54, D1/D2 review)', () => {
  it('is a page for each of a deck slide’s steps, click by click, and one for any other slide', () => {
    expect(slidePages('deck', ordered(0, true)).map((p) => p.title)).toEqual([
      '1 · Placeholder group',
      '1 · Placeholder group · click 1 of 2',
      '1 · Placeholder group · click 2 of 2',
    ]);
    expect(new Set(slidePages('deck', ordered(0, true)).map((p) => p.key)).size).toBe(3);
    expect(slidePages('deck', ordered(1, false))).toHaveLength(1);
    const slides = [ordered(0, true), ordered(1, false)];
    expect(presentationPages('deck', slides, 0, null)).toMatchObject({ start: 0 });
    expect(presentationPages('deck', slides, 0, null).pages).toHaveLength(4);
    // Opened on the deck's slide while the screens show its second click: from that click's page.
    expect(presentationPages('deck', slides, 0, 2).start).toBe(2);
    expect(presentationPages('deck', slides, 1, null).start).toBe(3);
  });

  it('is live, with the screens’ zoom offered, on the step the screens show and no other', () => {
    const pages = slidePages('deck', ordered(0, true));
    const state = up(1);
    expect(pages.map((p) => p.live?.(state) ?? false)).toEqual([false, true, false]);
    expect(pages.map((p) => (p.onScreens?.(state) ?? null) !== null)).toEqual([false, true, false]);
    expect(pages.map((p) => p.live?.(up(2)) ?? false)).toEqual([false, false, true]);
  });
});
