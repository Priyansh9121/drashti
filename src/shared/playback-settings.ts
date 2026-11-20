import { z } from 'zod';

/*
 * Sound and picture… (alpha.20: the owner's Q60-34 and his "Yes, all A" to Q60-39 P2 A and P6 (a) A): a file's own
 * playback settings, kept with it in the library (migration 089, media.playback) and heard wherever it plays, in the
 * hall and on the stream alike. Bass and Treble (−12 to +12 dB), Voice boost (clearer speech: less rumble under 100 Hz
 * and a lift at 3 kHz), the sound's delay against the picture and the captions' delay (−2 to +2 s in 10 ms steps).
 * Never on the stream's own sound input (the mixer's line in: the microphones).
 */

export const TONE_DB = { min: -12, max: 12 } as const;
export const DELAY_MS = { min: -2000, max: 2000, step: 10 } as const;

export interface PlaybackSettings {
  /** The low shelf (120 Hz), dB. */
  bassDb: number;
  /** The high shelf (6 kHz), dB. */
  trebleDb: number;
  /** Voice boost: a high-pass at 100 Hz and a +5 dB peak at 3 kHz. */
  voice: boolean;
  /** + : the sound comes this much later than the picture (ms). */
  soundDelayMs: number;
  /** + : the captions come this much later than the picture (ms). */
  captionDelayMs: number;
}

export const NO_PLAYBACK_SETTINGS: PlaybackSettings = {
  bassDb: 0,
  trebleDb: 0,
  voice: false,
  soundDelayMs: 0,
  captionDelayMs: 0,
};

// Red (x47, slice 6a): the settings' rules, their tone and their words, still to be written.
export const playbackSettingsSchema = z.any();

export function readPlaybackSettings(_kept: string | null | undefined): PlaybackSettings {
  return NO_PLAYBACK_SETTINGS;
}

export const isPlainPlayback = (_s: PlaybackSettings): boolean => true;

/** A file's tone: what its sound's filters do; none when its settings leave its sound as it is. */
export interface Tone {
  bassDb: number;
  trebleDb: number;
  voice: boolean;
}

export function toneOf(_s: PlaybackSettings): Tone | null {
  return null;
}

/** One filter of a tone, as Web Audio's BiquadFilterNode takes it. */
export interface ToneFilter {
  type: 'lowshelf' | 'highshelf' | 'highpass' | 'peaking';
  frequency: number;
  gain: number;
  q: number;
}

export const TONE_EASE_S = 0.03;

export function toneFilters(_tone: Tone | null): ToneFilter[] {
  return [];
}

export function delayWords(_ms: number, _what: 'sound' | 'captions'): string {
  return '';
}
