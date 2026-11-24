import { describe, expect, it, vi } from 'vitest';
import {
  afterCueStart,
  cueStarted,
  heldUntilStarted,
  isCueStarted,
  startedNow,
  whenCueStarted,
} from './cue-started';

describe("the operator preview's word that a cued picture started at Go", () => {
  it('runs what waits for it once it starts, at once once it has, and nothing cancelled', () => {
    const waited = vi.fn(),
      cancelled = vi.fn();
    whenCueStarted('cue-a', waited);
    whenCueStarted('cue-a', cancelled)();
    expect(waited).not.toHaveBeenCalled();
    cueStarted('cue-a');
    expect(waited).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
    const after = vi.fn();
    whenCueStarted('cue-a', after);
    expect(after).toHaveBeenCalledTimes(1);
    const other = vi.fn();
    whenCueStarted('cue-b', other);
    expect(other).not.toHaveBeenCalled();
  });

  it("counts a start only at a rate above 0 while it plays: never the Go lead's rate 0 with play, nor a paused rate", () => {
    // a22-review-cuelive SHOULD-2: anything else counted would let the operator window's work run ahead of LIVE's rate.
    expect(startedNow({ playbackRate: 0, paused: false }), 'rate 0 playing (the Go lead)').toBe(false);
    expect(startedNow({ playbackRate: 0, paused: true }), 'a ratechange to 0').toBe(false);
    expect(startedNow({ playbackRate: 1, paused: true }), 'rate 1 while paused').toBe(false);
    expect(startedNow({ playbackRate: 1, paused: false }), 'rate 1 playing').toBe(true);
    expect(startedNow({ playbackRate: 1.03, paused: false }), 'caught up').toBe(true);
  });

  it("holds LIVE's scene past Go until its picture has started, 250 ms past Go at the latest", () => {
    expect(isCueStarted('cue-c')).toBe(false);
    expect(heldUntilStarted('cue-c', 1000, 1100)).toBe(true);
    expect(heldUntilStarted('cue-c', 1000, 1250)).toBe(false);
    expect(afterCueStart('cue-c').fallbackMs).toBe(250);
    cueStarted('cue-c');
    expect(isCueStarted('cue-c')).toBe(true);
    expect(heldUntilStarted('cue-c', 1000, 1100)).toBe(false);
  });
});
