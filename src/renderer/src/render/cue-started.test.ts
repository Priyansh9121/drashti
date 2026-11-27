import { describe, expect, it, vi } from 'vitest';
import {
  afterCueStart,
  cueShown,
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

  it("gives a cue up for good when LIVE's wait ends without its start, whatever the computer's clock says then", () => {
    // a22-review-cuelive SHOULD-6: the wait's 250 ms runs on the page's steady clock, the keeper reads Date.now(); a
    // clock set back a moment kept LIVE's old scene until the next engine change.
    expect(heldUntilStarted('cue-d', 1000, 1249)).toBe(true);
    afterCueStart('cue-d').gaveUp?.();
    expect(heldUntilStarted('cue-d', 1000, 1249), 'the clock 1 ms short at the fallback').toBe(false);
  });

  // golive (a24-goearly.md, joined run 2's Mac M6, video-cue-crossfade:306): released at LIVE's rate, the operator
  // window's own Go work (LIVE's scene keeper, the Screens previews) ran for about 100 ms from +17 ms, right over LIVE's
  // first moving frames: no rendering step until +118, so their frame callbacks never came, and LIVE's video frames
  // were shown at 33 ms steps. That work waits for LIVE's first moving frame shown; LIVE's own picture, for its rate.
  it("lets the operator window's Go work run once LIVE's first moving frame is shown, not at its rate", () => {
    const work = vi.fn();
    afterCueStart('cue-g', 'shown').whenStarted(work);
    cueStarted('cue-g');
    expect(work, 'not at its rate').not.toHaveBeenCalled();
    cueShown('cue-g');
    expect(work, 'once its first moving frame is shown').toHaveBeenCalledTimes(1);
    expect(afterCueStart('cue-g', 'shown').fallbackMs, 'no longer than today: 250 ms past Go').toBe(250);
    const later = vi.fn();
    afterCueStart('cue-g', 'shown').whenStarted(later);
    expect(later, 'at once once it has been').toHaveBeenCalledTimes(1);
  });

  it("holds LIVE's scene past its rate until its first moving frame is shown, 250 ms past Go at the latest", () => {
    cueStarted('cue-h');
    expect(heldUntilStarted('cue-h', 1000, 1100, 'shown'), 'its rate set, nothing moved yet').toBe(true);
    expect(heldUntilStarted('cue-h', 1000, 1250, 'shown'), '250 ms past Go').toBe(false);
    cueShown('cue-h');
    expect(heldUntilStarted('cue-h', 1000, 1100, 'shown')).toBe(false);
  });
});
