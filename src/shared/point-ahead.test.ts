import { describe, expect, it } from 'vitest';
import type { DeckSlide } from './deck';
import { leastToSpareKb, pointedClip, roomToLoadAhead, sameClip, spareKb } from './point-ahead';

/*
 * A deck slide pointed at (C3, Session 58: Q57-26): the clip a click on its row plays first, from where, and whether
 * this computer has the memory to load it ahead.
 */

const deck = (more: Partial<DeckSlide> = {}): DeckSlide => ({
  transition: { name: 'push', durationMs: 400 },
  steps: [
    { clipId: 'placeholder-clip-0', clipMs: 1500, transitionMs: 400, lastId: 'placeholder-last-0' },
    { clipId: 'placeholder-clip-1', clipMs: 1500, lastId: 'placeholder-last-1' },
  ],
  media: [],
  ...more,
});

describe('pointedClip', () => {
  it('is the first step’s clip, from past the deck’s own transition, as a jump plays it', () => {
    expect(pointedClip(deck())).toEqual({ mediaId: 'placeholder-clip-0', fromMs: 400 });
    // No transition of its own: from its start.
    const plain = deck({
      steps: [{ clipId: 'placeholder-clip-0', clipMs: 1500, lastId: 'placeholder-last-0' }],
    });
    expect(pointedClip(plain)).toEqual({ mediaId: 'placeholder-clip-0', fromMs: 0 });
  });

  it('is none where a click plays no clip', () => {
    expect(pointedClip(undefined)).toBeNull();
    expect(pointedClip(deck({ steps: [] }))).toBeNull();
    // Being prepared: its clips are still being made.
    expect(pointedClip(deck({ preparing: true }))).toBeNull();
    // A first step with no motion, or one whose whole clip is the deck's own transition (shown at its last frame).
    expect(
      pointedClip(
        deck({ steps: [{ clipId: 'placeholder-clip-0', clipMs: 0, lastId: 'placeholder-last-0' }] }),
      ),
    ).toBeNull();
    expect(
      pointedClip(
        deck({
          steps: [
            { clipId: 'placeholder-clip-0', clipMs: 400, transitionMs: 400, lastId: 'placeholder-last-0' },
          ],
        }),
      ),
    ).toBeNull();
    // A deck Drashti plays itself: its effects come from its shapes.
    expect(
      pointedClip(deck({ steps: [], motion: { stepsMs: [500], effects: [], approximate: false } })),
    ).toBeNull();
  });

  it('tells the same clip from the same point', () => {
    const a = { mediaId: 'placeholder-clip-0', fromMs: 400 };
    expect(sameClip(a, { ...a })).toBe(true);
    expect(sameClip(a, { ...a, fromMs: 0 })).toBe(false);
    expect(sameClip(a, null)).toBe(false);
    expect(sameClip(null, null)).toBe(true);
  });
});

describe('memory to spare', () => {
  const GB = 1024 * 1024;

  it('wants 400 MB, or a twentieth of the memory where that is more', () => {
    expect(leastToSpareKb(4 * GB)).toBe(400 * 1024);
    expect(leastToSpareKb(8 * GB)).toBe(8 * GB * 0.05);
    expect(leastToSpareKb(16 * GB)).toBe(16 * GB * 0.05);
  });

  it('counts a Mac’s file cache and purgeable pages as spare, Linux’s available, Windows’s free', () => {
    const mac = { total: 8 * GB, free: 60 * 1024, fileBacked: 780 * 1024, purgeable: 20 * 1024 };
    expect(spareKb(mac, 'darwin')).toBe(860 * 1024);
    // An 8 GB Mac with 860 MB to give: loaded ahead. The same Mac with its cache gone: not.
    expect(roomToLoadAhead(mac, 'darwin')).toBe(true);
    expect(roomToLoadAhead({ ...mac, fileBacked: 100 * 1024 }, 'darwin')).toBe(false);
    expect(spareKb({ total: 8 * GB, free: 100, available: 2 * GB }, 'linux')).toBe(2 * GB);
    const windows = { total: 16 * GB, free: 3 * GB };
    expect(roomToLoadAhead(windows, 'win32')).toBe(true);
    expect(roomToLoadAhead({ ...windows, free: 700 * 1024 }, 'win32')).toBe(false);
  });
});
