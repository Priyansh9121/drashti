/*
 * How loud the sound the encoder is given is (MED-1, Session 31). The worker measures what it hands to
 * FFmpeg, the stream page's sound and the silence that keeps time when the page sends none alike, so
 * "No sound" (../no-sound.ts) means nothing reached the stream or the recording: an unplugged microphone,
 * a muted desk, or a stream page that stopped sending.
 *
 * It is measured a second at a time: the RMS of both channels together, and a second below QUIET_DBFS
 * is quiet. Chromium's fake microphone, a short beep every half second between pure silence, is never
 * quiet this way (each second has a beep in it), and neither is a voice between its words.
 */

/** A second whose RMS (both channels) is below this is quiet: dBFS. */
export const QUIET_DBFS = -50;
/** The level said for a second of pure silence, in dBFS. */
const SILENCE_DB = -120;
const QUIET_MEAN_SQUARE = 10 ** (QUIET_DBFS / 10);

export class SoundMeter {
  /** Sum of squares, and frames counted, in the second being measured. */
  private squares = 0;
  private counted = 0;
  /** Frames of quiet seconds in a row, up to the end of the last whole second. */
  private quietFrames = 0;
  private last: number | null = null;

  constructor(
    private readonly rate = 48_000,
    private readonly channels = 2,
  ) {}

  /** Samples just handed to the encoder: interleaved, `frames` of them on each channel. */
  add(samples: Float32Array, frames: number): void {
    const end = Math.min(samples.length, Math.max(0, frames) * this.channels);
    let at = 0;
    while (at < end) {
      const room = (this.rate - this.counted) * this.channels;
      const stop = Math.min(end, at + room);
      let squares = this.squares;
      for (let i = at; i < stop; i++) {
        const v = samples[i] ?? 0;
        squares += v * v;
      }
      this.squares = squares;
      this.counted += (stop - at) / this.channels;
      at = stop;
      if (this.counted >= this.rate) this.endSecond();
    }
  }

  private endSecond(): void {
    const mean = this.squares / (this.counted * this.channels);
    this.last = mean > 0 ? Math.max(SILENCE_DB, 10 * Math.log10(mean)) : SILENCE_DB;
    this.quietFrames = mean < QUIET_MEAN_SQUARE ? this.quietFrames + this.counted : 0;
    this.squares = 0;
    this.counted = 0;
  }

  /** How long the sound has stayed quiet, to the end of the last whole second: ms. */
  quietMs(): number {
    return Math.round((this.quietFrames * 1000) / this.rate);
  }

  /** The last whole second's level (dBFS), or null before the first. */
  db(): number | null {
    return this.last;
  }

  /** Neither on air nor recording: the next time starts afresh. */
  reset(): void {
    this.squares = 0;
    this.counted = 0;
    this.quietFrames = 0;
    this.last = null;
  }
}
