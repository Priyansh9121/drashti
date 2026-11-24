import { describe, expect, it } from 'vitest';
import { longestPcmWait, type PcmDelivery } from './pcm-gaps';

/** Deliveries every `every` ms from `start`, with one wait of exactly `hole.ms` from `hole.at` (wall = steady clock). */
function deliveries(
  start: number,
  end: number,
  every: number,
  hole?: { at: number; ms: number },
): PcmDelivery[] {
  const times: number[] = [];
  if (!hole) for (let t = start; t <= end; t += every) times.push(t);
  else {
    for (let t = start; t < hole.at; t += every) times.push(t);
    times.push(hole.at, hole.at + hole.ms);
    for (let t = hole.at + hole.ms + every; t <= end; t += every) times.push(t);
  }
  return times.map((t) => ({ wall: t, mono: t }));
}

const BOUND = 1000 / 30;

describe("the stream's PCM through the long drawing frame (video-cue-audio-queue.spec.ts)", () => {
  it("alpha.22 gate 3, attempt 3 (CI's Mac): its one 35.2 ms wait ended before the long frame began, and does not count", () => {
    // From the measure's start (+0.3 ms) to the first delivery (+35.3); the long frame ran +46.3 to +546.3, every wait
    // in it 20.0-23.8 ms (s5-pcm-queue.json of job 138742820909).
    const list = deliveries(0.3, 600, 21, { at: 0.3, ms: 35.2 });
    expect(Math.max(...list.slice(1).map((d, i) => d.mono - (list[i]?.mono ?? 0)))).toBeGreaterThan(BOUND);
    expect(longestPcmWait(list, 46.3, 546.3)).toBeLessThanOrEqual(BOUND);
  });

  it("a wait as long INSIDE the long frame still counts, as would one of Final A's size (38.9 ms; where Final A's own wait fell was not recorded)", () => {
    expect(longestPcmWait(deliveries(0.3, 600, 21, { at: 200, ms: 35.2 }), 46.3, 546.3)).toBeGreaterThan(
      BOUND,
    );
    expect(longestPcmWait(deliveries(0.3, 600, 21, { at: 300, ms: 38.9 }), 46.3, 546.3)).toBeCloseTo(38.9, 5);
  });

  it('counts a wait that runs into the frame, out of it, or across all of it, whole', () => {
    expect(longestPcmWait(deliveries(0, 600, 21, { at: 30, ms: 40 }), 46.3, 546.3)).toBeCloseTo(40, 5);
    expect(longestPcmWait(deliveries(0, 600, 21, { at: 530, ms: 40 }), 46.3, 546.3)).toBeCloseTo(40, 5);
    // The fault the spec is for: no PCM while the drawing page is held.
    expect(longestPcmWait(deliveries(0, 600, 21, { at: 40, ms: 515 }), 46.3, 546.3)).toBeCloseTo(515, 5);
  });

  it('counts a wait that touches the frame in the same whole millisecond of the wall clock', () => {
    // a22-review-pcmwindow MUST-1: Date.now() rounds down, so a wait ending 0.5 ms into a frame begun at 1000.2 is
    // stamped 1000, the frame's own start.
    const list = [
      { wall: 0, mono: 0 },
      { wall: 46, mono: 46.4 },
      { wall: 60, mono: 60 },
    ];
    expect(longestPcmWait(list, 46, 546)).toBeCloseTo(46.4, 5);
    // And at the end: a wait that starts in the frame's last whole millisecond (`to` is rounded down too).
    const dense = deliveries(0, 540, 10);
    expect(
      longestPcmWait([...dense, { wall: 546, mono: 546 }, { wall: 600, mono: 600.5 }], 46, 546),
    ).toBeCloseTo(54.5, 5);
  });

  it('fails closed: no frame, a reversed one, or too few deliveries is an error, never a pass', () => {
    const list = deliveries(0, 600, 21);
    expect(() => longestPcmWait(list, Number.NaN, 546.3)).toThrow('No long frame');
    expect(() => longestPcmWait(list, 546.3, 46.3)).toThrow('No long frame');
    expect(() => longestPcmWait(list, 46.3, 46.3)).toThrow('No long frame');
    expect(() => longestPcmWait([{ wall: 0, mono: 0 }], 46.3, 546.3)).toThrow('Too few');
  });

  it("alpha.22 gate 3, attempt 3: its own recorded waits (job 138742820909's s5-pcm-queue.json), judged 23.834 ms", () => {
    // Each recorded wait over 20 ms, as ms from the watch's start: [from, to] on the wall clock, and its steady length.
    // Between them every wait was 20 ms or less (not recorded). The watch ended at +554.3; the frame ran +46.3 to +546.3.
    const recorded: [number, number, number][] = [
      [0.306, 35.306, 35.195458],
      [54.306, 77.306, 22.189],
      [77.306, 100.306, 23.626],
      [118.306, 140.306, 22.024],
      [140.306, 162.306, 21.268],
      [162.306, 184.306, 22.34],
      [204.306, 225.306, 21.055],
      [225.306, 247.306, 22.439],
      [247.306, 267.306, 20.007],
      [267.306, 289.306, 21.801],
      [289.306, 310.306, 21.112],
      [310.306, 332.306, 21.848],
      [332.306, 354.306, 21.29],
      [354.306, 375.306, 21.406],
      [375.306, 396.306, 20.738],
      [396.306, 417.306, 20.974],
      [417.306, 440.306, 23.101],
      [459.306, 481.306, 21.94],
      [481.306, 505.306, 23.834],
      [525.306, 546.306, 20.451],
    ];
    const list: PcmDelivery[] = [];
    for (const [after, at, ms] of recorded)
      list.push({ wall: after, mono: after }, { wall: at, mono: after + ms });
    list.push({ wall: 554.3, mono: 554.3 });
    expect(longestPcmWait(list, 0, 554.3), 'the whole watch, as judged until now').toBeCloseTo(35.195458, 5);
    expect(longestPcmWait(list, 46.306, 546.306), 'over the long frame').toBeCloseTo(23.834, 5);
  });
});
