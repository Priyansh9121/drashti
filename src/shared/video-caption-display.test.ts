import { describe, expect, it } from 'vitest';
import { initialEngineState } from './engine/state';
import { captionBandFor } from './video-caption-display';
import type { VideoCaptionTrack } from './video-captions';

const TRACK: VideoCaptionTrack = {
  id: 'gu-file',
  language: 'gu',
  automatic: false,
  name: 'Sample.gu.srt',
  cues: [{ startMs: 1000, endMs: 3000, text: 'નમૂનો એક' }],
};
function state() {
  return {
    ...initialEngineState(),
    layers: {
      ...initialEngineState().layers,
      background: {
        kind: 'media' as const,
        media: 'video' as const,
        mediaId: 'video',
        startedAt: 1,
        loop: false,
        fit: 'fit' as const,
      },
    },
    captions: {
      lines: ['Live placeholder'],
      language: 'en' as const,
      size: 'small' as const,
      place: 'bottom' as const,
      audience: false,
    },
    videoCaptions: { video: { track: TRACK, size: 'large' as const, place: 'top' as const } },
  };
}

describe('one caption band for video and live speech', () => {
  it('shows the video on hall and stream regardless of the live audience setting, using admin size/place', () => {
    for (const screen of ['hall', 'stream'] as const)
      expect(captionBandFor(state(), screen, { mediaId: 'video', sourceMs: 1500 })).toEqual({
        lines: ['નમૂનો એક'],
        language: 'gu',
        size: 'large',
        place: 'top',
        source: 'video',
      });
  });
  it('shows none on the stage and keeps live speech aside even in gaps or while the file loads', () => {
    expect(captionBandFor(state(), 'stage', { mediaId: 'video', sourceMs: 1500 })).toBeNull();
    expect(captionBandFor(state(), 'stream', { mediaId: 'video', sourceMs: 3500 })).toBeNull();
    expect(captionBandFor(state(), 'stream', null)).toBeNull();
  });
  it('takes video words off for Black-out, Wallpaper and Clear all, with no stale cue from the old video', () => {
    const base = state();
    const actual = { mediaId: 'video', sourceMs: 1500 };
    expect(captionBandFor({ ...base, blackout: true }, 'hall', actual)).toBeNull();
    expect(captionBandFor({ ...base, wallpaper: true }, 'stream', actual)).toBeNull();
    expect(captionBandFor({ ...base, layers: initialEngineState().layers }, 'hall', actual)).toBeNull();
    expect(captionBandFor(base, 'hall', { mediaId: 'old-video', sourceMs: 1500 })).toBeNull();
  });
  it('returns live speech under its own screen policy when video captions are off', () => {
    const base = { ...state(), videoCaptions: {} };
    expect(captionBandFor(base, 'hall', null)).toBeNull();
    expect(captionBandFor(base, 'stage', null)?.lines).toEqual(['Live placeholder']);
    expect(captionBandFor(base, 'stream', null)?.source).toBe('live');
  });
});
