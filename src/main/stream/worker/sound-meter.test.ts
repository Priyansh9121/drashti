import { describe, expect, it } from 'vitest';
import { QUIET_DBFS, SoundMeter } from './sound-meter';

/*
 * The worker's measure of the sound it gives the encoder (MED-1, Session 31): a second at a time, RMS over
 * both channels, and how long it has stayed below -50 dBFS.
 */

const RATE = 48_000;

/** Interleaved stereo: `seconds` of a sine at `amplitude` (or silence), in chunks of `chunk` frames. */
function* tone(seconds: number, amplitude: number, chunk = 1600): Generator<[Float32Array, number]> {
  const frames = Math.round(seconds * RATE);
  for (let at = 0; at < frames; at += chunk) {
    const n = Math.min(chunk, frames - at);
    const out = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const v = amplitude * Math.sin((2 * Math.PI * 440 * (at + i)) / RATE);
      out[i * 2] = v;
      out[i * 2 + 1] = v;
    }
    yield [out, n];
  }
}

function feed(meter: SoundMeter, seconds: number, amplitude: number, chunk?: number): void {
  for (const [samples, frames] of tone(seconds, amplitude, chunk)) meter.add(samples, frames);
}

describe('the sound meter (No sound)', () => {
  it('counts quiet a whole second at a time, and a loud second starts it again', () => {
    const meter = new SoundMeter();
    expect(meter.quietMs()).toBe(0);
    expect(meter.db()).toBeNull();
    feed(meter, 2.5, 0);
    expect(meter.quietMs()).toBe(2000);
    feed(meter, 0.5, 0);
    expect(meter.quietMs()).toBe(3000);
    feed(meter, 1, 0.2);
    expect(meter.quietMs()).toBe(0);
    expect(meter.db()).toBeCloseTo(-16.99, 1);
    feed(meter, 20, 0);
    expect(meter.quietMs()).toBe(20_000);
    expect(meter.db()).toBe(-120);
  });

  it('takes sound just under -50 dBFS as quiet, and just over as sound', () => {
    // A sine's RMS is its amplitude less 3.01 dB.
    const amplitudeAt = (dbfs: number) => Math.SQRT2 * 10 ** (dbfs / 20);
    const meter = new SoundMeter();
    feed(meter, 3, amplitudeAt(QUIET_DBFS - 0.5));
    expect(meter.quietMs()).toBe(3000);
    feed(meter, 1, amplitudeAt(QUIET_DBFS + 0.5));
    expect(meter.quietMs()).toBe(0);
  });

  it('never calls the fake microphone’s beep quiet: 20 ms of tone every 500 ms', () => {
    const meter = new SoundMeter();
    for (let s = 0; s < 120; s++) {
      feed(meter, 0.02, 0.5, 960);
      feed(meter, 0.48, 0, 960);
    }
    expect(meter.quietMs()).toBe(0);
  });

  it('is the same whatever size the chunks come in, and starts afresh when reset', () => {
    const a = new SoundMeter();
    const b = new SoundMeter();
    feed(a, 7.3, 0, 17);
    feed(b, 7.3, 0, 4800);
    expect(a.quietMs()).toBe(7000);
    expect(b.quietMs()).toBe(7000);
    a.reset();
    expect(a.quietMs()).toBe(0);
    expect(a.db()).toBeNull();
    feed(a, 1.4, 0);
    expect(a.quietMs()).toBe(1000);
  });

  it('reads no further than the frames it is told of', () => {
    const meter = new SoundMeter();
    const loud = new Float32Array(RATE * 2 * 2).fill(0.5);
    // Two seconds of samples, but only the first second's frames are new: the rest is never counted.
    meter.add(new Float32Array(RATE * 2), RATE);
    expect(meter.quietMs()).toBe(1000);
    meter.add(loud, 0);
    expect(meter.quietMs()).toBe(1000);
  });
});
