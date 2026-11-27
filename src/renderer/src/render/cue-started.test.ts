import { describe, expect, it, vi } from 'vitest';
import {
  afterCueStart,
  cueShown,
  cueStarted,
  heldUntilStarted,
  isCueStarted,
  startedNow,
  tellCueStart,
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

describe("LIVE's teller: its cued picture's start and its first moving frame, told to the operator window (golive)", () => {
  // a24-review-golive MUST-1: a dead watch passes every e2e (crossfade:306 then passes on the 250 ms fallback), so the
  // teller itself (render/BackgroundMedia.tsx's tellStart effect, moved here unchanged) is tested with a stand-in.
  class Element extends EventTarget {
    playbackRate = 1;
    paused = true;
    currentTime = 1.000002;
    asked = new Map<number, VideoFrameRequestCallback>();
    listeners = 0;
    private next = 0;
    override addEventListener(...args: Parameters<EventTarget['addEventListener']>): void {
      this.listeners++;
      super.addEventListener(...args);
    }
    override removeEventListener(...args: Parameters<EventTarget['removeEventListener']>): void {
      this.listeners--;
      super.removeEventListener(...args);
    }
    requestVideoFrameCallback(run: VideoFrameRequestCallback): number {
      this.asked.set(++this.next, run);
      return this.next;
    }
    cancelVideoFrameCallback(id: number): void {
      this.asked.delete(id);
    }
    /** Its rate set, and the event a task later, as Chromium sends it. */
    rate(value: number): void {
      this.playbackRate = value;
      this.dispatchEvent(new Event('ratechange'));
    }
    playing(): void {
      this.paused = false;
      this.dispatchEvent(new Event('playing'));
    }
    present(mediaTime: number): void {
      const runs = [...this.asked.values()];
      this.asked.clear();
      for (const run of runs) run(0, { mediaTime } as VideoFrameCallbackMetadata);
    }
  }
  const shown = (cueId: string) => !heldUntilStarted(cueId, 0, 1, 'shown');

  it("tells its rate at Go after the Go lead's warm-up, and 'shown' only at its first moving frame, once", () => {
    const v = new Element();
    const stop = tellCueStart(v, 'tell-a');
    // The Go lead's warm-up: rate 0, play.
    v.rate(0);
    v.playing();
    expect(isCueStarted('tell-a'), 'the warm-up is no start').toBe(false);
    v.rate(1);
    expect(isCueStarted('tell-a'), 'its rate at Go').toBe(true);
    expect(shown('tell-a'), 'nothing moved yet').toBe(false);
    v.present(1.000002);
    expect(shown('tell-a'), 'the held trimmed frame again').toBe(false);
    v.present(1.033);
    expect(shown('tell-a'), 'its first moving frame').toBe(true);
    expect(v.asked.size, 'nothing more asked').toBe(0);
    stop();
  });

  it("takes keepAwake's wakes for no start: rate 0, play and pause, the events coming while it is paused", () => {
    const v = new Element();
    const stop = tellCueStart(v, 'tell-b');
    v.playbackRate = 0;
    v.dispatchEvent(new Event('ratechange'));
    v.dispatchEvent(new Event('playing'));
    v.rate(1);
    expect(isCueStarted('tell-b'), 'a rate while paused is no start').toBe(false);
    expect(v.asked.size, 'no watch').toBe(0);
    stop();
  });

  it('asks for one watch only, through the later rates that bring it into step', () => {
    const v = new Element();
    const stop = tellCueStart(v, 'tell-c');
    v.rate(0);
    v.playing();
    v.rate(1);
    v.rate(1.033);
    v.rate(1.05);
    expect(v.asked.size, 'one frame asked for').toBe(1);
    v.present(1.033);
    expect(shown('tell-c')).toBe(true);
    stop();
  });

  it('watches from where it is when it starts with no warm-up (playing at its rate)', () => {
    const v = new Element();
    v.currentTime = 2.5;
    const stop = tellCueStart(v, 'tell-d');
    v.playing();
    expect(isCueStarted('tell-d')).toBe(true);
    v.present(2.5);
    expect(shown('tell-d')).toBe(false);
    v.present(2.5333);
    expect(shown('tell-d')).toBe(true);
    stop();
  });

  it('lets go of its listeners and its frame asked for when stopped (unmounted, or a new cue), and tells nothing after', () => {
    const v = new Element();
    const stop = tellCueStart(v, 'tell-e');
    v.rate(0);
    v.playing();
    v.rate(1);
    expect(v.asked.size).toBe(1);
    stop();
    expect(v.listeners, 'both listeners removed').toBe(0);
    expect(v.asked.size, 'its frame callback cancelled').toBe(0);
    v.present(1.033);
    expect(shown('tell-e'), 'never told after its stop').toBe(false);
    // A new cue on the same element: only the new one is told.
    const next = tellCueStart(v, 'tell-f');
    v.rate(1.04);
    v.present(1.067);
    expect(shown('tell-f')).toBe(true);
    expect(shown('tell-e'), 'the old cue: still nothing').toBe(false);
    next();
    expect(v.listeners).toBe(0);
  });
});
