import type { DrashtiBridge } from '../../../shared/bridge';
import { LINGER_MS, type PointAt, REST_MS } from '../../../shared/point-ahead';

/*
 * The slide's row the operator is about to click (C3, Session 58: Q57-26), told to the main process, which has the
 * screens load that deck slide's first clip ahead (main/point-ahead.ts). A click on a deck slide's row used to hold the
 * slide going away while the clip loaded (0.14-0.37 s on CI's computers); a hand takes longer than that to come to
 * rest on a row and press it. Said:
 * - when the pointer comes to rest on a row (REST_MS: one passing over rows on its way says nothing), or presses it;
 * - when the keyboard comes to a row (Tab: its focus seen), or a row's number is typed (Jump to a row);
 * - and, once the pointer has left the list and the keyboard has moved off (LINGER_MS later, so a moment away and back
 *   loads nothing again), that it is on none: the screens let the clip go.
 * Only what changes is said; one row at a time.
 */

const same = (a: PointAt | null, b: PointAt | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.presentationId === b.presentationId &&
    a.slideIndex === b.slideIndex &&
    a.arrangementId === b.arrangementId);

interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (timer: unknown) => void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (timer) => {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
};

export class RowPointer {
  /** Where the pointer rests (once it has rested), where the keyboard is, and the row whose number is typed. */
  private pointer: PointAt | null = null;
  private keys: PointAt | null = null;
  private typed: PointAt | null = null;
  private told: PointAt | null = null;
  private resting: unknown = null;
  private leaving: unknown = null;
  private blurring: unknown = null;
  private untyping: unknown = null;

  constructor(
    private readonly tell: (target: PointAt | null) => void,
    private readonly timers: Timers = realTimers,
  ) {}

  /** The pointer comes onto a row: said once it rests there. */
  enter(target: PointAt): void {
    this.cancel('leaving');
    this.cancel('resting');
    this.resting = this.timers.set(() => {
      this.resting = null;
      this.pointer = target;
      this.update();
    }, REST_MS);
  }

  /** A press on a row: said at once. */
  press(target: PointAt): void {
    this.cancel('leaving');
    this.cancel('resting');
    this.pointer = target;
    this.update();
  }

  /** The pointer leaves a row: let go of a moment later, unless it comes onto a row again. */
  leave(): void {
    this.cancel('resting');
    if (this.leaving !== null) return;
    this.leaving = this.timers.set(() => {
      this.leaving = null;
      this.pointer = null;
      this.update();
    }, LINGER_MS);
  }

  /** The keyboard comes to a row: said at once. */
  focus(target: PointAt): void {
    this.cancel('blurring');
    this.keys = target;
    this.update();
  }

  /** The keyboard leaves a row: let go of a moment later, unless it comes to another. */
  blur(): void {
    if (this.keys === null || this.blurring !== null) return;
    this.blurring = this.timers.set(() => {
      this.blurring = null;
      this.keys = null;
      this.update();
    }, LINGER_MS);
  }

  /**
   * The row whose number is being typed (Jump to a row), said at once, before the pointer's and the keyboard's; null
   * as the number goes (Enter, Esc, its wait over): let go of a moment later, so Enter's own row is still loaded as it
   * goes up.
   */
  number(target: PointAt | null): void {
    if (target) {
      this.cancel('untyping');
      this.typed = target;
      this.update();
      return;
    }
    if (this.typed === null || this.untyping !== null) return;
    this.untyping = this.timers.set(() => {
      this.untyping = null;
      this.typed = null;
      this.update();
    }, LINGER_MS);
  }

  private cancel(which: 'resting' | 'leaving' | 'blurring' | 'untyping'): void {
    if (this[which] !== null) this.timers.clear(this[which]);
    this[which] = null;
  }

  private update(): void {
    const now = this.typed ?? this.pointer ?? this.keys;
    if (same(now, this.told)) return;
    this.told = now;
    this.tell(now);
  }
}

/** The operator window's own (its rows', in the library and in the playlist). */
export const rowPointer = new RowPointer((target) => {
  // A page without the bridge (a unit test's) says nothing.
  void (globalThis as { drashti?: DrashtiBridge }).drashti?.engine.pointAt(target).catch(() => undefined);
});
