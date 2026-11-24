import { describe, expect, it } from 'vitest';
import {
  beepAfterFlash,
  beepTimes,
  firstSoundTime,
  flashTimes,
  framesFrom,
  loudWindows,
  median,
  type Frame,
  type Sound,
} from '../../../tests/e2e/av-sync';

/*
 * The e2e lip-sync and recovery checks' readers (tests/e2e/av-sync.ts; a22-review-x86 M2 and S6): what FFmpeg says
 * of a recording, and where its flashes and beeps start. Generated numbers only.
 */

const RATE = 48_000;

/** A second-by-second flash of three frames at 30 a second, from `from` (s), on a dark picture. */
function frames(seconds: number, from = 0): Frame[] {
  return Array.from({ length: seconds * 30 }, (_, n) => ({
    t: from + n / 30,
    luma: n % 30 >= 15 && n % 30 < 18 ? 235 : 16,
  }));
}

/** A 1 kHz beep of 0.1 s at each half second past the second, `late` (s) after it, from `start` (s). */
function sound(seconds: number, late = 0, start = 0, level = 0.5): Sound {
  const samples = new Float32Array(seconds * RATE);
  for (let i = 0; i < samples.length; i++) {
    const t = start + i / RATE - late;
    const into = (((t - 0.5) % 1) + 1) % 1;
    samples[i] = into < 0.1 ? level * Math.sin(2 * Math.PI * 1000 * into + 0.3) : 0;
  }
  return { start, rate: RATE, samples };
}

describe('reading a recording back', () => {
  it('takes each frame’s time and brightness from showinfo, and the first sound frame’s time from ashowinfo', () => {
    const log = [
      'Input #0, matroska,webm, from ‘placeholder.mkv’:',
      '[Parsed_showinfo_2 @ 0x1] n:   0 pts:      0 pts_time:0       duration:    512 fmt:gray s:32x18 i:P iskey:1 type:I checksum:BCBA3DDE plane_checksum:[BCBA3DDE] mean:[255] stdev:[0.0]',
      '[Parsed_showinfo_2 @ 0x1] n:   1 pts:    512 pts_time:0.0333333 duration:    512 fmt:gray s:32x18 i:P iskey:0 type:P checksum:1 plane_checksum:[1] mean:[16] stdev:[0.0]',
      '[Parsed_showinfo_2 @ 0x1]   side data - spherical: none',
    ].join('\r\n');
    expect(framesFrom(log)).toEqual([
      { t: 0, luma: 255 },
      { t: 0.0333333, luma: 16 },
    ]);
    expect(
      firstSoundTime(
        '[Parsed_ashowinfo_0 @ 0x2] n:0 pts:-1024 pts_time:-0.0213333 fmt:fltp channels:1 rate:48000 nb_samples:1024\n' +
          '[Parsed_ashowinfo_0 @ 0x2] n:1 pts:0 pts_time:0 fmt:fltp channels:1 rate:48000 nb_samples:1024',
      ),
    ).toBeCloseTo(-0.0213333, 7);
    expect(firstSoundTime('no sound here')).toBeNull();
  });

  it('finds each flash at its first bright frame, and none in a picture that never changes', () => {
    const flashes = flashTimes(frames(4, 2));
    expect(flashes).toHaveLength(4);
    flashes.forEach((t, i) => expect(t).toBeCloseTo(2.5 + i, 6));
    expect(flashTimes(frames(4).map((f) => ({ ...f, luma: 16 })))).toEqual([]);
  });

  it('finds each beep’s start to the sample, and none in a silent recording', () => {
    const beeps = beepTimes(sound(4, 0.0123, 1.25));
    expect(beeps).toHaveLength(4);
    beeps.forEach((b, i) => expect(b).toBeCloseTo(1.5 + i + 0.0123, 3));
    expect(beepTimes({ start: 0, rate: RATE, samples: new Float32Array(4 * RATE) })).toEqual([]);
    // Below the floor (well under any beep the stream carries) is silence, not a beep.
    expect(beepTimes(sound(4, 0, 0, 0.01))).toEqual([]);
  });

  it('pairs each flash with its nearest beep, the sound later as +', () => {
    const offsets = beepAfterFlash(flashTimes(frames(6)), beepTimes(sound(6, 0.2)));
    expect(offsets).toHaveLength(6);
    expect(median(offsets)).toBeCloseTo(0.2, 3);
    expect(median(beepAfterFlash(flashTimes(frames(6)), beepTimes(sound(6, -0.03))))).toBeCloseTo(-0.03, 3);
    // A flash with no beep near it is left out, never paired with one a second away.
    const near = beepAfterFlash([1.5, 2.5], [1.52]);
    expect(near).toHaveLength(1);
    expect(near[0]).toBeCloseTo(0.02, 6);
  });

  it('takes the middle value', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('counts the loud windows between two times on the file’s clock, and none where it is silent', () => {
    const s = sound(4, 0, 10);
    // Beeps at 10.5, 11.5, 12.5 and 13.5 s, each 0.1 s: two 50 ms windows each (their first and last samples are
    // quieter than the level).
    expect(loudWindows(s, 10, 14, 0.2)).toBe(8);
    expect(loudWindows(s, 11.6, 12.4, 0.2)).toBe(0);
    expect(loudWindows({ ...s, samples: new Float32Array(s.samples.length) }, 10, 14, 0.02)).toBe(0);
  });
});
