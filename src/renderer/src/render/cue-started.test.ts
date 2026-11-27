import { describe, expect, it, vi } from 'vitest';
import {
  afterCueStart,
  cueShown,
  cueStarted,
  heldUntilStarted,
  isCueStarted,
  startedNow,
  watchFirstMove,
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

  it("keeps LIVE's own picture's wait on its rate: it comes on as before, the window's other work after", () => {
    const own = vi.fn(),
      other = vi.fn();
    afterCueStart('cue-i').whenStarted(own);
    afterCueStart('cue-i', 'shown').whenStarted(other);
    cueStarted('cue-i');
    expect(own, "LIVE's own picture, at its rate").toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    cueShown('cue-i');
    expect(other).toHaveBeenCalledTimes(1);
    expect(own).toHaveBeenCalledTimes(1);
  });

  it('counts a first moving frame shown as a start too', () => {
    const own = vi.fn();
    afterCueStart('cue-j').whenStarted(own);
    cueShown('cue-j');
    expect(own).toHaveBeenCalledTimes(1);
    expect(isCueStarted('cue-j')).toBe(true);
    expect(heldUntilStarted('cue-j', 1000, 1100, 'shown')).toBe(false);
  });
});

describe("LIVE's watch for its cued picture's first moving frame (golive)", () => {
  /** A stand-in element: its frame callbacks, run as the test presents frames. */
  const element = () => {
    const asked = new Map<number, VideoFrameRequestCallback>();
    let next = 0;
    return {
      asked,
      requestVideoFrameCallback: (run: VideoFrameRequestCallback) => {
        asked.set(++next, run);
        return next;
      },
      cancelVideoFrameCallback: (id: number) => {
        asked.delete(id);
      },
      present(mediaTime: number) {
        const runs = [...asked.values()];
        asked.clear();
        for (const run of runs) run(0, { mediaTime } as VideoFrameCallbackMetadata);
      },
    };
  };

  it('tells it once, on the first frame past where it was held, never for the held trimmed frame', () => {
    const v = element();
    const shown = vi.fn();
    watchFirstMove(v, 1.000002, shown);
    v.present(1.000002);
    v.present(1.0005);
    expect(shown, 'the held frame, and one within a ms of it').not.toHaveBeenCalled();
    v.present(1.033);
    expect(shown).toHaveBeenCalledTimes(1);
    v.present(1.067);
    expect(shown, 'once').toHaveBeenCalledTimes(1);
    expect(v.asked.size, 'nothing more asked').toBe(0);
  });

  it('asks nothing more once stopped (the cue gone, the preview closed)', () => {
    const v = element();
    const shown = vi.fn();
    const stop = watchFirstMove(v, 1, shown);
    stop();
    expect(v.asked.size).toBe(0);
    v.present(1.033);
    expect(shown).not.toHaveBeenCalled();
  });
});
