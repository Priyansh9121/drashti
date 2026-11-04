import { describe, expect, it } from 'vitest';
import { SpeechResampler } from './speech-tap';

/* The stream's sound input for live captions (Part 10): mono 16 kHz 16-bit from the input's own sound. */

describe('the sound for live captions (Part 10)', () => {
  it('takes 48 kHz down to 16 kHz, a third of the samples, carrying the rest on to the next piece', () => {
    const r = new SpeechResampler();
    const a = r.push(new Float32Array(4_800).fill(0.5), 48_000);
    const b = r.push(new Float32Array(4_801).fill(0.5), 48_000);
    expect(a.length + b.length).toBeGreaterThanOrEqual(3_200);
    expect(a.length + b.length).toBeLessThanOrEqual(3_201);
    expect(a[10]).toBe(Math.round(0.5 * 32_767));
  });

  it('averages each step (a tone far above speech fades out) and clips at full scale', () => {
    const r = new SpeechResampler();
    const high = new Float32Array(4_800).map((_, i) => (i % 2 === 0 ? 1 : -1));
    const out = r.push(high, 48_000);
    const loudest = Math.max(...Array.from(out, (v) => Math.abs(v)));
    expect(loudest).toBeLessThan(32_767 / 2);
    const loud = new SpeechResampler().push(new Float32Array(300).fill(4), 48_000);
    expect(loud[5]).toBe(32_767);
  });

  it('takes 44.1 kHz too', () => {
    const out = new SpeechResampler().push(new Float32Array(44_100).fill(-0.25), 44_100);
    expect(Math.abs(out.length - 16_000)).toBeLessThanOrEqual(1);
    expect(out[100]).toBe(Math.round(-0.25 * 32_767));
  });
});
