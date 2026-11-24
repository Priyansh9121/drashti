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
    const list = deliveries(0.3, 554, 21, { at: 0.3, ms: 35.2 });
    expect(Math.max(...list.slice(1).map((d, i) => d.mono - (list[i]?.mono ?? 0)))).toBeGreaterThan(BOUND);
    expect(longestPcmWait(list, 46.3, 546.3)).toBeLessThanOrEqual(BOUND);
  });

  it('a wait as long INSIDE the long frame still counts, as does Final A’s 38.9 ms (a21-s5-1123-152334-44457, the Mac)', () => {
    expect(longestPcmWait(deliveries(0.3, 554, 21, { at: 200, ms: 35.2 }), 46.3, 546.3)).toBeGreaterThan(
      BOUND,
    );
    expect(longestPcmWait(deliveries(0.3, 545, 21, { at: 300, ms: 38.9 }), 46.3, 546.3)).toBeCloseTo(38.9, 5);
  });

  it('counts a wait that runs into the frame or out of it, whole', () => {
    expect(longestPcmWait(deliveries(0, 554, 21, { at: 30, ms: 40 }), 46.3, 546.3)).toBeCloseTo(40, 5);
    expect(longestPcmWait(deliveries(0, 600, 21, { at: 530, ms: 40 }), 46.3, 546.3)).toBeCloseTo(40, 5);
  });
});
