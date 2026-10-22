import { describe, expect, it } from 'vitest';
import { type AudioLayer, type BackgroundLayer, initialEngineState } from '../../../shared/engine/state';
import { skipsOf } from './skips';

/*
 * Where Back 15 s, Forward 15 s and Last 10 s show (Session 50): under the live picture for the background
 * video and a single sound; an audio playlist's track has them beside its Play and Pause, in the Music panel.
 * Dimmed until the file's length is known. Placeholder ids only.
 */

const withLayers = (background: BackgroundLayer | null, audio: AudioLayer | null) => {
  const state = initialEngineState();
  return { ...state, layers: { ...state.layers, background, audio } };
};

const video = (durationMs?: number): BackgroundLayer => ({
  kind: 'media',
  mediaId: 'video',
  media: 'video',
  fit: 'fit',
  loop: false,
  startedAt: 0,
  ...(durationMs === undefined ? {} : { durationMs }),
});

const sound = (over: Partial<AudioLayer> = {}): AudioLayer => ({
  id: 's',
  title: 'Placeholder sound',
  mediaId: 'sound',
  volume: 1,
  loop: false,
  startedAt: 0,
  durationMs: 90_000,
  ...over,
});

describe('the skip buttons (Session 50)', () => {
  it('show for a background video, waiting for its length; never for a picture, a colour or nothing', () => {
    expect(skipsOf(withLayers(video(60_000), null), 'background')).toBe('ready');
    expect(skipsOf(withLayers(video(), null), 'background')).toBe('waiting');
    expect(skipsOf(withLayers({ ...video(60_000), media: 'image' }, null), 'background')).toBeNull();
    expect(skipsOf(withLayers({ kind: 'color', color: '#000000' }, null), 'background')).toBeNull();
    expect(skipsOf(withLayers(null, null), 'background')).toBeNull();
    expect(skipsOf(null, 'background')).toBeNull();
  });

  it('show under the live picture for a single sound; an audio playlist’s track has its own beside Play and Pause', () => {
    expect(skipsOf(withLayers(null, sound()), 'sound')).toBe('ready');
    expect(skipsOf(withLayers(null, sound({ durationMs: undefined })), 'sound')).toBe('waiting');
    expect(skipsOf(withLayers(null, sound({ mediaId: null })), 'sound')).toBeNull();
    const track = sound({
      music: {
        playlistId: 'pl',
        name: 'Placeholder music',
        tracks: [{ mediaId: 'sound', title: 'Placeholder sound' }],
        index: 0,
        loop: false,
        shuffle: false,
      },
    });
    expect(skipsOf(withLayers(null, track), 'sound')).toBeNull();
    expect(skipsOf(withLayers(null, track), 'music')).toBe('ready');
    expect(skipsOf(withLayers(null, { ...track, durationMs: undefined }), 'music')).toBe('waiting');
    expect(skipsOf(withLayers(null, sound()), 'music')).toBeNull();
  });
});
