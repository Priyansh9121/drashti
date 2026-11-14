import { describe, expect, it, vi } from 'vitest';
import type { DeckSlide } from '../shared/deck';
import type { PointAt, PointedClip } from '../shared/point-ahead';
import { MEMORY_CHECK_MS, PointAhead } from './point-ahead';

/*
 * The deck slide the operator points at, told to the screens that load ahead (C3, Session 58: Q57-26): only as it
 * changes, never while memory is short, and let go of when memory runs short while it is loaded.
 */

const clipDeck = (clipId: string, transitionMs = 400): DeckSlide => ({
  steps: [{ clipId, clipMs: 1500, transitionMs, lastId: `${clipId}-last` }],
  media: [],
});

const decks: Record<string, DeckSlide | undefined> = {
  '0': clipDeck('placeholder-clip-a'),
  '1': clipDeck('placeholder-clip-b', 0),
  '2': undefined,
};

function setUp() {
  const told: (PointedClip | null)[] = [];
  let room = true;
  let tick: (() => void) | null = null;
  const stopped = vi.fn();
  const ahead = new PointAhead({
    deckAt: (t: PointAt) => {
      if (t.presentationId === 'unreadable') throw new Error('cannot read');
      return decks[String(t.slideIndex)];
    },
    room: () => room,
    tell: (clip) => told.push(clip),
    every: (fn, ms) => {
      expect(ms).toBe(MEMORY_CHECK_MS);
      tick = fn;
      return () => {
        tick = null;
        stopped();
      };
    },
  });
  const at = (slideIndex: number, presentationId = 'placeholder-deck'): PointAt => ({
    presentationId,
    slideIndex,
    arrangementId: null,
  });
  return {
    ahead,
    told,
    at,
    stopped,
    setRoom: (r: boolean) => {
      room = r;
    },
    tick: () => {
      tick?.();
    },
    watching: () => tick !== null,
  };
}

describe('PointAhead', () => {
  it('tells the screens a deck slide’s first clip and its jump’s start, only as it changes', () => {
    const s = setUp();
    s.ahead.point(s.at(0));
    s.ahead.point(s.at(0));
    expect(s.told).toEqual([{ mediaId: 'placeholder-clip-a', fromMs: 400 }]);
    s.ahead.point(s.at(1));
    expect(s.told.at(-1)).toEqual({ mediaId: 'placeholder-clip-b', fromMs: 0 });
    // A slide with no clip, the pointer off the list, a presentation that cannot be read: nothing loaded ahead.
    s.ahead.point(s.at(2));
    expect(s.told.at(-1)).toBeNull();
    s.ahead.point(s.at(0));
    s.ahead.point(null);
    expect(s.told.at(-1)).toBeNull();
    s.ahead.point(s.at(0, 'unreadable'));
    expect(s.told).toHaveLength(5);
    expect(s.ahead.current()).toBeNull();
  });

  it('loads nothing ahead while memory is short, lets go of what it loaded when memory runs short, and loads it again when memory is back', () => {
    const s = setUp();
    s.setRoom(false);
    s.ahead.point(s.at(0));
    expect(s.told).toEqual([]);
    expect(s.watching()).toBe(true);
    s.setRoom(true);
    s.tick();
    expect(s.told).toEqual([{ mediaId: 'placeholder-clip-a', fromMs: 400 }]);
    s.setRoom(false);
    s.tick();
    expect(s.told.at(-1)).toBeNull();
    // Off the list: memory is no longer watched.
    s.ahead.point(null);
    expect(s.watching()).toBe(false);
    expect(s.stopped).toHaveBeenCalledTimes(1);
    s.ahead.point(s.at(0));
    s.setRoom(true);
    s.ahead.stop();
    expect(s.told.at(-1)).toBeNull();
    expect(s.watching()).toBe(false);
  });
});
