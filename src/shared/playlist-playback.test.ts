import { describe, expect, it } from 'vitest';
import type { PlaylistItemInfo } from './playlists';
import { playlistLeftMs, playlistTotals } from './playlist-playback';

const video = (
  id: string,
  durationMs: number,
  whenEnds?: 'next' | 'loop',
): Extract<PlaylistItemInfo, { kind: 'media' }> => ({
  id,
  kind: 'media',
  mediaId: id,
  media: 'video',
  label: `Placeholder ${id}`,
  durationMs,
  missing: false,
  unplayable: null,
  timers: [],
  ...(whenEnds ? { whenEnds } : {}),
});

describe('playlist timing', () => {
  it('adds timed rows only and says when a length is still unknown', () => {
    expect(
      playlistTotals([
        video('a', 10000),
        video('b', 20000),
        { id: 'h', kind: 'header', label: 'Placeholder', color: null },
      ]),
    ).toEqual({ rows: 3, durationMs: 30000, unknown: 0 });
    expect(playlistTotals([{ ...video('a', 10000), durationMs: null }])).toEqual({
      rows: 1,
      durationMs: 0,
      unknown: 1,
    });
  });
  it('follows the drawn order along automatic Next item links and stops at the last timed item', () => {
    const items = [video('a', 10000), video('b', 20000, 'next'), video('c', 30000, 'next')];
    expect(playlistLeftMs(items, ['c', 'b', 'a'], 'c', 25000, false)).toBe(55000);
    expect(playlistLeftMs(items, ['a', 'b', 'c'], 'a', 5000, false)).toBe(5000);
  });
  it('gives no end with Repeat all or a loop, or a following row that needs a person', () => {
    expect(playlistLeftMs([video('a', 10000)], ['a'], 'a', 5000, true)).toBeNull();
    expect(playlistLeftMs([video('a', 10000, 'loop')], ['a'], 'a', 5000, false)).toBeNull();
    const picture: PlaylistItemInfo = { ...video('b', 0), media: 'image' };
    expect(playlistLeftMs([video('a', 10000, 'next'), picture], ['a', 'b'], 'a', 5000, false)).toBeNull();
  });
});
