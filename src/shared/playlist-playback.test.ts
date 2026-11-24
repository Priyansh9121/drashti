import type { AudioLayer } from './engine/state';
import type { MusicPlaylist } from './music';
import { describe, expect, it } from 'vitest';
import type { PlaylistItemInfo } from './playlists';
import { mediaLengthBetweenPoints, musicLeftMs, playlistLeftMs, playlistTotals } from './playlist-playback';

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

it('Music ends in its running shuffle order, using the live points and each following track’s own length', () => {
  const playlist: MusicPlaylist = {
    id: 'list',
    name: 'Placeholder list',
    loop: false,
    shuffle: true,
    tracks: [
      { id: 'a', mediaId: 'a', name: 'Placeholder a', durationMs: 30000, playingMs: 10000, playable: true },
      { id: 'b', mediaId: 'b', name: 'Placeholder b', durationMs: 30000, playingMs: 10000, playable: true },
    ],
  };
  const run = {
    playlistId: 'list',
    name: playlist.name,
    loop: false,
    shuffle: true,
    index: 0,
    tracks: [
      { mediaId: 'b', title: 'Placeholder b' },
      { mediaId: 'a', title: 'Placeholder a' },
    ],
  };
  const audio: AudioLayer = {
    id: 'audio',
    title: 'Placeholder b',
    mediaId: 'b',
    volume: 1,
    loop: false,
    startedAt: 1000,
    durationMs: 30000,
    clip: { startMs: 2000, endMs: 12000 },
    music: run,
  };
  expect(musicLeftMs(audio, playlist, 6000)).toBe(15000);
  expect(musicLeftMs({ ...audio, pausedAtMs: 5000 }, playlist, 6000)).toBeNull();
  expect(musicLeftMs({ ...audio, music: { ...run, loop: true } }, playlist, 6000)).toBeNull();
  expect(mediaLengthBetweenPoints(30000, JSON.stringify({ startMs: 2000, endMs: 12000, markers: [] }))).toBe(
    10000,
  );
  expect(playlistTotals([{ ...video('points', 30000), playingMs: 10000 }]).durationMs).toBe(10000);
});

it('subtracts an automatic video overlap exactly once from totals and the finish time', () => {
  const items = [video('a', 10000, 'next'), video('b', 10000)];
  const playback = { shuffle: false, repeatAll: false, playOrder: ['a', 'b'], crossfadeMs: 2000 };
  expect(playlistTotals(items, playback)).toEqual({ rows: 2, durationMs: 18000, unknown: 0 });
  expect(playlistLeftMs(items, playback.playOrder, 'a', 7000, false, 2000)).toBe(15000);
  expect(playlistLeftMs(items, playback.playOrder, 'b', 7000, false, 2000)).toBe(7000);
});

it('uses the saved draw and the shorter span bound for each overlapping pair', () => {
  const items = [video('a', 10000), video('b', 4000, 'next')];
  expect(
    playlistTotals(items, { shuffle: true, repeatAll: false, playOrder: ['b', 'a'], crossfadeMs: 9000 })
      .durationMs,
  ).toBe(12000);
  expect(playlistTotals(items).durationMs).toBe(14000);
});
