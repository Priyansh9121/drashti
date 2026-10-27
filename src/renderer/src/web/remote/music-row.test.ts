import { describe, expect, it } from 'vitest';
import type { AudioLayer } from '../../../../shared/engine/state';
import { musicRowAction } from './music-row';

/*
 * An audio playlist's row on the phone (Session 54, D5 review), as the window's Music panel has its Play and Pause:
 * Pause while that playlist plays, Play on from where it was while it is paused (never from its first track again),
 * and Play from its first track for any other. Made-up ids.
 */

const playing = (playlistId: string, paused: boolean): AudioLayer => ({
  id: 'track',
  title: 'Placeholder track',
  mediaId: 'm-track',
  volume: 1,
  loop: false,
  startedAt: 0,
  music: { playlistId, name: 'Placeholder tunes', tracks: [], index: 1, loop: false, shuffle: false },
  ...(paused ? { pausedAtMs: 4000 } : {}),
});

describe('an audio playlist’s row on the phone', () => {
  it('pauses the one playing, plays a paused one on where it was, and starts any other from its first track', () => {
    expect(musicRowAction('tunes', playing('tunes', false))).toBe('pause');
    expect(musicRowAction('tunes', playing('tunes', true))).toBe('resume');
    expect(musicRowAction('other', playing('tunes', false))).toBe('play');
    expect(musicRowAction('other', playing('tunes', true))).toBe('play');
    expect(musicRowAction('tunes', null)).toBe('play');
  });

  it('starts an audio playlist over a single sound playing, which is not one', () => {
    const sound: AudioLayer = { ...playing('tunes', false), music: undefined };
    expect(musicRowAction('tunes', sound)).toBe('play');
  });
});
