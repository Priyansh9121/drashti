import { describe, expect, it } from 'vitest';
import { afterCueStart, cueShown, cueStarted } from './cue-started';
import { atGoMoment, type GoMomentClock } from './go-moment';

/**
 * A page's event loop, as far as a cue's Go moment needs it: the engine's time, its animation frames (each run at a
 * frame's time) and its timers (in order of when they are due, then of when they were asked).
 */
class Page implements GoMomentClock {
  time = 0;
  order: string[] = [];
  private frames = new Map<number, () => void>();
  private timers: { id: number; due: number; run: () => void }[] = [];
  private next = 0;
  now(): number {
    return this.time;
  }
  frame(run: () => void): number {
    const id = ++this.next;
    this.frames.set(id, run);
    return id;
  }
  cancelFrame(id: number): void {
    this.frames.delete(id);
  }
  later(run: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = ++this.next;
    this.timers.push({ id, due: this.time + ms, run });
    return id as unknown as ReturnType<typeof setTimeout>;
  }
  cancelLater(id: ReturnType<typeof setTimeout>): void {
    this.timers = this.timers.filter((t) => t.id !== (id as unknown as number));
  }
  /** A frame at `at`: its animation frame callbacks, then the timers due by then. */
  frameAt(at: number): void {
    this.time = at;
    const due = [...this.frames.values()];
    this.frames.clear();
    for (const run of due) run();
    this.runTimers();
  }
  runTimers(): void {
    for (;;) {
      const due = this.timers.filter((t) => t.due <= this.time);
      const ready = due.sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (!ready) return;
      this.timers = this.timers.filter((t) => t !== ready);
      ready.run();
    }
  }
}

describe("a page's own work for a cue's Go moment", () => {
  it('runs on the first animation frame at or past Go, and not before', () => {
    const page = new Page();
    const seen: number[] = [];
    atGoMoment(100, (now) => seen.push(now), { checkNow: false }, page);
    page.frameAt(83);
    expect(seen).toEqual([]);
    page.frameAt(101);
    expect(seen).toEqual([101]);
    page.frameAt(117);
    expect(seen).toEqual([101]);
  });

  it('runs at once where asked and Go has passed, and never once cancelled', () => {
    const page = new Page();
    page.time = 120;
    const seen: number[] = [];
    atGoMoment(100, (now) => seen.push(now), { checkNow: true }, page);
    expect(seen).toEqual([120]);
    const cancelled: number[] = [];
    page.time = 0;
    const cancel = atGoMoment(100, (now) => cancelled.push(now), { checkNow: true }, page);
    cancel();
    page.frameAt(101);
    expect(cancelled).toEqual([]);
  });

  it('on the hall, the stream and the sound pages: in the frame itself, as before, whatever its pictures do', () => {
    const page = new Page();
    page.later(() => page.order.push('rate'), 100);
    atGoMoment(100, () => page.order.push('work'), { checkNow: false }, page);
    page.frameAt(102);
    expect(page.order).toEqual(['work', 'rate']);
  });
});

/** A cued picture's start at Go, as its page sees it: a timer due at Go sets its rate, then says it has started. */
function picture(page: Page, at: number) {
  const waiting: (() => void)[] = [];
  let started = false;
  page.later(() => {
    page.order.push('rate');
    started = true;
    for (const run of waiting.splice(0)) run();
  }, at - page.time);
  const whenStarted = (run: () => void): (() => void) => {
    if (started) {
      run();
      return () => undefined;
    }
    waiting.push(run);
    return () => {
      const i = waiting.indexOf(run);
      if (i >= 0) waiting.splice(i, 1);
    };
  };
  return { whenStarted, fallbackMs: 250 };
}

describe("the operator preview's own work for a cue's Go moment (QA23-CUELIVE-1)", () => {
  // alpha.22's gate 3 (run 45449968552, CI's Mac): LIVE's cued picture set its rate 23-27 ms after Go, behind the
  // operator window's own work, while the hall's was set 7-10 ms after it; LIVE started 36.6 and 40.0 ms after Go.
  it('runs only once its cued picture has started at Go, never ahead of it', () => {
    const page = new Page();
    const afterStart = picture(page, 100);
    atGoMoment(100, () => page.order.push('work'), { checkNow: false, afterStart }, page);
    // The page is busy past Go: its next frame comes at 102, its frame callbacks before its timers.
    page.frameAt(102);
    expect(page.order).toEqual(['rate', 'work']);
  });

  it('runs at once where its picture started already, and a check of the moment later where it never starts', () => {
    const page = new Page();
    const afterStart = picture(page, 100);
    page.time = 101;
    page.runTimers();
    atGoMoment(100, () => page.order.push('work'), { checkNow: true, afterStart }, page);
    expect(page.order).toEqual(['rate', 'work']);
    const lone = new Page();
    const seen: number[] = [];
    const never = { whenStarted: () => () => undefined, fallbackMs: 250 };
    atGoMoment(100, (now) => seen.push(now), { checkNow: false, afterStart: never }, lone);
    lone.frameAt(101);
    expect(seen).toEqual([]);
    lone.frameAt(351);
    expect(seen).toEqual([351]);
  });

  it('counts its wait for a picture that never starts from Go, so a second wait begun later is not 250 ms more', () => {
    // a22-review-cuelive SHOULD-1: the slot's activation begins its wait only after the swap's render.
    const page = new Page();
    const never = { whenStarted: () => () => undefined, fallbackMs: 250 };
    const seen: number[] = [];
    page.time = 350;
    atGoMoment(100, (now) => seen.push(now), { checkNow: true, afterStart: never }, page);
    page.time = 351;
    page.runTimers();
    expect(seen).toEqual([351]);
  });

  it('says it gave up when its wait ends without the start, and not when the picture started', () => {
    // a22-review-cuelive SHOULD-6: the keeper then lets go without reading the clock.
    const lone = new Page();
    const gaveUp: string[] = [];
    const never = { whenStarted: () => () => undefined, fallbackMs: 250, gaveUp: () => gaveUp.push('lone') };
    atGoMoment(100, () => undefined, { checkNow: false, afterStart: never }, lone);
    lone.frameAt(101);
    lone.frameAt(351);
    expect(gaveUp).toEqual(['lone']);
    const page = new Page();
    const afterStart = { ...picture(page, 100), gaveUp: () => gaveUp.push('started') };
    atGoMoment(100, () => undefined, { checkNow: false, afterStart }, page);
    page.frameAt(102);
    page.frameAt(400);
    expect(gaveUp).toEqual(['lone']);
  });
});

describe("the operator window's Go work behind LIVE's first moving frame (golive)", () => {
  // Joined run 2's Mac M6 (video-cue-crossfade:306): released at LIVE's rate (+10.5 ms), the operator window's Go work
  // held its main thread from +17 to +118 ms, over LIVE's first moving frames (shown at +55 and +107), so their frame
  // callbacks never came and the spec read the third frame; the Screens previews and LIVE's scene keeper wait for the
  // first moving frame shown.
  it("runs a Screens preview's or LIVE's scene keeper's work once LIVE's first moving frame is shown, not at its rate", () => {
    const page = new Page();
    page.later(() => {
      page.order.push('rate');
      cueStarted('gm-a');
    }, 100);
    page.later(() => {
      page.order.push('shown');
      cueShown('gm-a');
    }, 145);
    atGoMoment(
      100,
      () => page.order.push('work'),
      { checkNow: false, afterStart: afterCueStart('gm-a', 'shown') },
      page,
    );
    page.frameAt(102);
    expect(page.order, 'not at its rate').toEqual(['rate']);
    page.frameAt(150);
    expect(page.order).toEqual(['rate', 'shown', 'work']);
  });
});
