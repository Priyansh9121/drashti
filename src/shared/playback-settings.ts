import { z } from 'zod';
import { VIDEO_SHAPES, type VideoShape } from './video-shape';

/*
 * Sound and picture… (alpha.20: the owner's Q60-34 and his "Yes, all A" to Q60-39 P2 A and P6 (a) A): a file's own
 * playback settings, kept with it in the library (migration 089, media.playback) and heard wherever it plays, in the
 * hall and on the stream alike. Bass and Treble (−12 to +12 dB), Voice boost (clearer speech: less rumble under 100 Hz
 * and a lift at 3 kHz), the sound's delay against the picture and the captions' delay (−2 to +2 s in 10 ms steps).
 * Never on the stream's own sound input (the mixer's line in: the microphones). And (slice 6b, P6 (c) A) a video's
 * Shape on the screens: as the file says, 16:9, 4:3, 1:1 or 21:9 (shared/video-shape.ts).
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
  /** A video's shape on the screens (slice 6b): as the file says, or one chosen. */
  shape: VideoShape;
}

export const NO_PLAYBACK_SETTINGS: PlaybackSettings = {
  bassDb: 0,
  trebleDb: 0,
  voice: false,
  soundDelayMs: 0,
  captionDelayMs: 0,
  shape: 'file',
};

const db = z.number().int().min(TONE_DB.min).max(TONE_DB.max);
const delay = z.number().int().min(DELAY_MS.min).max(DELAY_MS.max).multipleOf(DELAY_MS.step);

export const playbackSettingsSchema = z
  .object({
    bassDb: db,
    trebleDb: db,
    voice: z.boolean(),
    soundDelayMs: delay,
    captionDelayMs: delay,
    // Slice 6b: settings kept before it (none of them published) read as the file's own shape.
    shape: z.enum(VIDEO_SHAPES).default('file'),
  })
  .strict();

/** What the library keeps (JSON text, or null for none), read back as settings: anything else is none. */
export function readPlaybackSettings(kept: string | null | undefined): PlaybackSettings {
  if (!kept) return NO_PLAYBACK_SETTINGS;
  try {
    const parsed = playbackSettingsSchema.safeParse(JSON.parse(kept));
    return parsed.success ? parsed.data : NO_PLAYBACK_SETTINGS;
  } catch {
    return NO_PLAYBACK_SETTINGS;
  }
}

/** Whether a file's settings change nothing (kept as none). */
export const isPlainPlayback = (s: PlaybackSettings): boolean =>
  s.bassDb === 0 &&
  s.trebleDb === 0 &&
  !s.voice &&
  s.soundDelayMs === 0 &&
  s.captionDelayMs === 0 &&
  s.shape === 'file';

/** A file's tone: what its sound's filters do; none when its settings leave its sound as it is. */
export interface Tone {
  bassDb: number;
  trebleDb: number;
  voice: boolean;
}

export function toneOf(s: PlaybackSettings): Tone | null {
  return s.bassDb === 0 && s.trebleDb === 0 && !s.voice
    ? null
    : { bassDb: s.bassDb, trebleDb: s.trebleDb, voice: s.voice };
}

/** One filter of a tone, as Web Audio's BiquadFilterNode takes it. */
export interface ToneFilter {
  type: 'lowshelf' | 'highshelf' | 'highpass' | 'peaking';
  frequency: number;
  gain: number;
  q: number;
}

/** How long a tone's change takes to ease in (setTargetAtTime's time constant, s): within a tenth of a second. */
export const TONE_EASE_S = 0.03;

/** Where Voice boost's high-pass sits while it is off: below anything heard, so the filter changes nothing. */
const HIGH_PASS_OFF_HZ = 10;

/**
 * The four filters of a tone, in the order a sound goes through them: the low shelf (Bass), the high shelf (Treble),
 * then Voice boost's high-pass and its presence peak. A tone of none is every filter flat: a sound that had one goes
 * back to as it is, smoothly (a sound that never had one gets no filters at all: audio/tone-chain.ts).
 */
export function toneFilters(tone: Tone | null): ToneFilter[] {
  const t = tone ?? { bassDb: 0, trebleDb: 0, voice: false };
  return [
    { type: 'lowshelf', frequency: 120, gain: t.bassDb, q: 0 },
    { type: 'highshelf', frequency: 6000, gain: t.trebleDb, q: 0 },
    { type: 'highpass', frequency: t.voice ? 100 : HIGH_PASS_OFF_HZ, gain: 0, q: Math.SQRT1_2 },
    { type: 'peaking', frequency: 3000, gain: t.voice ? 5 : 0, q: 0.9 },
  ];
}

/** A delay as the window says it: "+0.25 s: the sound comes a quarter of a second later than the picture". */
export function delayWords(ms: number, what: 'sound' | 'captions'): string {
  const subject = what === 'sound' ? 'the sound comes' : 'the captions come';
  if (ms === 0) return `0 s: ${subject} with the picture`;
  const abs = Math.abs(ms);
  const amount =
    abs === 250
      ? 'a quarter of a second'
      : abs === 500
        ? 'half a second'
        : abs === 1000
          ? 'a second'
          : `${(abs / 1000).toFixed(2)} s`;
  const sign = ms > 0 ? '+' : '−';
  return `${sign}${(abs / 1000).toFixed(2)} s: ${subject} ${amount} ${ms > 0 ? 'later' : 'earlier'} than the picture`;
}
