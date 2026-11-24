import { describe, expect, it } from 'vitest';
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
      const ready = this.timers
        .filter((t) => t.due <= this.time)
        .sort((a, b) => a.due - b.due || a.id - b.id)[0];
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
});
