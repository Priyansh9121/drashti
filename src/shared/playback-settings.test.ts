import { describe, expect, it } from 'vitest';
import {
  delayWords,
  isPlainPlayback,
  NO_PLAYBACK_SETTINGS,
  playbackSettingsSchema,
  readPlaybackSettings,
  toneFilters,
  toneOf,
} from './playback-settings';

/* Sound and picture… (alpha.20): a file's own settings, their ranges and defaults, its tone's filters, the words. */

describe('a file’s own playback settings', () => {
  it('keeps Bass and Treble within ±12 dB and the delays within ±2 s in 10 ms steps; none is the default', () => {
    expect(readPlaybackSettings(null)).toEqual(NO_PLAYBACK_SETTINGS);
    expect(readPlaybackSettings('not json')).toEqual(NO_PLAYBACK_SETTINGS);
    const ok = { bassDb: 12, trebleDb: -12, voice: true, soundDelayMs: 250, captionDelayMs: -2000 };
    // Kept before slice 6b's Shape: the file's own shape.
    expect(readPlaybackSettings(JSON.stringify(ok))).toEqual({ ...ok, shape: 'file' });
    for (const bad of [
      { ...ok, bassDb: 13 },
      { ...ok, trebleDb: -12.5 },
      { ...ok, soundDelayMs: 2010 },
      { ...ok, captionDelayMs: 255 },
      { ...ok, extra: 1 },
    ]) {
      expect(playbackSettingsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
      expect(readPlaybackSettings(JSON.stringify(bad))).toEqual(NO_PLAYBACK_SETTINGS);
    }
    expect(isPlainPlayback(NO_PLAYBACK_SETTINGS)).toBe(true);
    expect(isPlainPlayback({ ...NO_PLAYBACK_SETTINGS, captionDelayMs: 10 })).toBe(false);
  });

  it('gives a tone only when Bass, Treble or Voice boost changes the sound; its filters, flat for none', () => {
    expect(toneOf(NO_PLAYBACK_SETTINGS)).toBeNull();
    expect(toneOf({ ...NO_PLAYBACK_SETTINGS, soundDelayMs: 200 })).toBeNull();
    expect(toneOf({ ...NO_PLAYBACK_SETTINGS, bassDb: 6 })).toEqual({ bassDb: 6, trebleDb: 0, voice: false });
    expect(toneFilters({ bassDb: 12, trebleDb: -12, voice: true })).toEqual([
      { type: 'lowshelf', frequency: 120, gain: 12, q: 0 },
      { type: 'highshelf', frequency: 6000, gain: -12, q: 0 },
      { type: 'highpass', frequency: 100, gain: 0, q: Math.SQRT1_2 },
      { type: 'peaking', frequency: 3000, gain: 5, q: 0.9 },
    ]);
    // None: every filter flat (Voice's high-pass below anything heard), so a sound that had a tone goes back as it was.
    expect(toneFilters(null).map((f) => [f.type, f.gain, f.frequency])).toEqual([
      ['lowshelf', 0, 120],
      ['highshelf', 0, 6000],
      ['highpass', 0, 10],
      ['peaking', 0, 3000],
    ]);
  });

  it('says a delay in words', () => {
    expect(delayWords(250, 'sound')).toBe(
      '+0.25 s: the sound comes a quarter of a second later than the picture',
    );
    expect(delayWords(-500, 'captions')).toBe(
      '−0.50 s: the captions come half a second earlier than the picture',
    );
    expect(delayWords(0, 'sound')).toBe('0 s: the sound comes with the picture');
    expect(delayWords(120, 'sound')).toBe('+0.12 s: the sound comes 0.12 s later than the picture');
  });
});
