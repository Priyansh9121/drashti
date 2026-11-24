/*
 * The cost spec's position code (QA23-FADE-9, the owner: "Read it from the recording (Rec.)"). Each generated video's
 * sound carries a quiet sweep beside its tone: a sine whose frequency rises steadily with the media position, so the
 * frequency heard at any moment says which moment of the file is playing then (the pitch is kept whatever the stream's
 * speed correction does). Read back from the stream's recording after the run, it gives each sound's heard position
 * every 20 ms, with no page thread in the way (CI's two-core Windows starved the sound page's 50 ms sampler for
 * 0.77-0.81 s at a fade's start: a22-fadeprep-1125-084705-80663).
 *
 * Pure functions on numbers (unit tests: src/main/testing/sweep-position.test.ts); the spec passes the clocks.
 */

/** A position sweep: its frequency at the file's 0 s, and how much it rises each second of the file (Hz). */
export interface Sweep {
  from: number;
  perSecond: number;
}

/** The frequency a sweep has at a media position (s). */
export function sweepHz(sweep: Sweep, position: number): number {
  return sweep.from + sweep.perSecond * position;
}

/** The media position (s) a sweep's frequency says. */
export function sweepPosition(sweep: Sweep, hz: number): number {
  return (hz - sweep.from) / sweep.perSecond;
}

/** Where to look for each sweep (Hz): its whole band, a little wider. */
export interface Band {
  lo: number;
  hi: number;
}

/** One window of a recording: its middle (s from the first sample), and each band's loudest frequency and level. */
export interface Reading {
  t: number;
  bands: { hz: number; level: number }[];
}

/**
 * Each band's loudest frequency, every `hop` seconds of the samples (mono), between `from` and `to` (s). The level is
 * that sine's amplitude (1 for a full-scale sine).
 */
export function readSweeps(
  _samples: Float32Array,
  _rate: number,
  _bands: readonly Band[],
  _options: { hop?: number; from?: number; to?: number } = {},
): Reading[] {
  return [];
}

/** One of a fade's two sounds, as the spec knows it. */
export interface FadeSound {
  role: 'out' | 'in';
  key: string;
  /** Which of the recording's bands carries its sweep, and the sweep. */
  band: number;
  sweep: Sweep;
  /** How far a heard position (s) is from where its clock says it should be at an engine moment (ms; + ahead). */
  offset: (heard: number, engineMs: number) => number;
}

export interface FadeInput {
  askedAt: number;
  at: number;
  durationMs: number;
  sounds: FadeSound[];
  /**
   * The outgoing sound's own median offset in its settled seconds, as the page's sampler read it (ms), or null when
   * it read none: the recording's clock is anchored so the heard sound matches it there.
   */
  settledMs: number | null;
}

export interface HeardSound {
  role: 'out' | 'in';
  key: string;
  /** Each reading from the ask to the fade's end where its gain is at least the floor's: ms into the fade, offset. */
  readings: { t: number; ms: number; gain: number }[];
}

export interface HeardFade {
  at: number;
  durationMs: number;
  /** The engine moment of the recording's first sample (ms), and how it was found. */
  anchor: { firstSampleAt: number; coarse: number; settledReadings: number; settledMedianMs: number };
  sounds: HeardSound[];
}

export interface HeardOptions {
  /** A band is read only at this share of its full level or more. */
  readable?: number;
  /** A sound counts only where its crossfade gain is at least this (the owner: 0.1). */
  minGain?: number;
  /** The outgoing sound's settled seconds: this long before the ask, until this long before it (ms). */
  settledFromMs?: number;
  settledToMs?: number;
}

/** Each fade's two sounds where they were heard, against their clocks; or why the recording can't say. */
export function heardFades(
  _readings: readonly Reading[],
  _fades: readonly FadeInput[],
  _options: HeardOptions = {},
): { fades: HeardFade[] } | { error: string } {
  return { error: 'not read yet' };
}
