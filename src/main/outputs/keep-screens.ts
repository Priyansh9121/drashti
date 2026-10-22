import type { PendingScreens } from '../../shared/keep-screens';
import { KEEP_SCREENS_MS } from '../../shared/keep-screens';
import type { ScreenStatus, ScreensResult, ScreensSnapshot } from '../../shared/screens';

/*
 * Keep these screens? (Session 50; Priyansh: in Set Up Screens… he chose the display his controls are on as the
 * audience picture by mistake, and couldn't get back). After a change that puts an output on a display (Set Up
 * Screens…'s Done or Finish, Show on, Screens' Use this display and On), Drashti asks for 15 s, with Keep and Go
 * back. Nothing pressed, it goes back by itself to exactly the screens as they were: the setup is taken before
 * the change, and Go back puts it back. Turning an output off asks nothing. A second change while one waits
 * keeps the first setup, so Go back returns to the screens before both, and its countdown starts again; a change
 * that puts nothing new on a display (an output turned off, Uncover) is taken in without a question of its own.
 * Quitting while one waits goes back too, so the next start never opens a change nobody kept.
 */

/** What each display shows: for each display with an output on it, which screen, of which group and role. */
export type Placed = ReadonlyMap<string, string>;

/** How a question ended: kept, gone back (Go back, Esc), or gone back by itself (nothing pressed in time). */
export type KeepEnding = 'kept' | 'went-back' | 'went-back-by-itself';

export interface KeepScreensDeps<S> {
  /** The screen setup now, to put back exactly. */
  capture(): S;
  /** Put a setup back. `quitting`: Drashti is quitting, so it is only saved (no window opens or closes). */
  restore(setup: S, quitting: boolean): ScreensResult;
  /** What each display shows now. */
  placed(): Placed;
  /** An output covers the controls now: it asks the same, large, in its middle. */
  coversControls(): boolean;
  /** The screens as they are, for Keep's answer. */
  snapshot(): ScreensSnapshot;
  /** The change waiting for an answer changed (null: answered, or gone back). */
  changed(pending: PendingScreens | null): void;
  /** A question ended (the operator is told when the screens went back). */
  ended?(how: KeepEnding): void;
  /** False: never ask (tests that are not about it, DRASHTI_TEST_KEEP_SCREENS=0). */
  asks?: boolean;
  /** How long it waits (a test may give less). */
  waitMs?: number;
  now?(): number;
  /** Do something after a while; the answer cancels it (tests give their own clock). */
  later?(fn: () => void, ms: number): () => void;
  log?(message: string): void;
}

const realLater = (fn: () => void, ms: number) => {
  const timer = setTimeout(fn, ms);
  return () => {
    clearTimeout(timer);
  };
};

/** Whether a change put an output on a display: some display shows something it did not (another screen, group or role). */
export function putsOutputOn(was: Placed, now: Placed): boolean {
  for (const [display, shows] of now) if (was.get(display) !== shows) return true;
  return false;
}

/**
 * The outputs over the display the controls are on (null: none can cover them, as windowed outputs never do).
 * A stopped output (Session 23) is still a window over its display.
 */
export function coveringScreens(status: readonly ScreenStatus[], controlsDisplayId: number | null): string[] {
  if (controlsDisplayId === null) return [];
  return status
    .filter((st) => (st.state === 'showing' || st.state === 'stopped') && st.displayId === controlsDisplayId)
    .map((st) => st.screenId);
}

interface Waiting<S> {
  /** The screens as they were before the first change it asks about. */
  before: S;
  deadline: number;
  coversControls: boolean;
  cancel: () => void;
}

export class KeepScreens<S> {
  private waiting: Waiting<S> | null = null;
  /** A change is being made: what its own reconcile tells (refresh) waits for the change's question. */
  private changing = false;

  constructor(private readonly deps: KeepScreensDeps<S>) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private log(message: string): void {
    this.deps.log?.(`Keep these screens?: ${message}`);
  }

  /** The change waiting for Keep or Go back, or null. */
  current(): PendingScreens | null {
    const w = this.waiting;
    return w ? { deadline: w.deadline, coversControls: w.coversControls } : null;
  }

  /** Make a screen change; one that puts an output on a display then waits for Keep or Go back. */
  change(run: () => ScreensResult): ScreensResult {
    if (this.deps.asks === false) return run();
    // With one waiting, the screens before it are the ones Go back returns to.
    const before = this.waiting ? this.waiting.before : this.deps.capture();
    const was = this.deps.placed();
    this.changing = true;
    let result: ScreensResult;
    try {
      result = run();
    } finally {
      this.changing = false;
    }
    if (!result.ok) return result;
    if (putsOutputOn(was, this.deps.placed())) this.ask(before);
    else this.refresh();
    return result;
  }

  private ask(before: S): void {
    this.waiting?.cancel();
    const ms = this.deps.waitMs ?? KEEP_SCREENS_MS;
    const cancel = (this.deps.later ?? realLater)(() => {
      this.answer(false, true);
    }, ms);
    const coversControls = this.deps.coversControls();
    this.waiting = { before, deadline: this.now() + ms, coversControls, cancel };
    this.log(
      `asked, ${String(Math.round(ms / 1000))} s to answer${coversControls ? ', an output over the controls asking too' : ''}`,
    );
    this.deps.changed(this.current());
  }

  /** Keep the change. */
  keep(): ScreensResult {
    return this.answer(true, false);
  }

  /** Go back to exactly the screens as they were before the change. */
  goBack(): ScreensResult {
    return this.answer(false, false);
  }

  private answer(keep: boolean, byItself: boolean): ScreensResult {
    const waiting = this.waiting;
    if (!waiting) return { ok: false, message: 'No screen change is waiting for an answer now.' };
    waiting.cancel();
    this.waiting = null;
    let result: ScreensResult;
    try {
      result = keep ? { ok: true, snapshot: this.deps.snapshot() } : this.deps.restore(waiting.before, false);
    } catch (error) {
      this.log(`could not go back (${error instanceof Error ? error.message : String(error)})`);
      result = {
        ok: false,
        message: 'Drashti could not put the screens back as they were. Change them in Screens.',
      };
    }
    // After the screens are back: the operator window has them as they were by the time the question goes.
    this.deps.changed(null);
    const how: KeepEnding = keep ? 'kept' : byItself ? 'went-back-by-itself' : 'went-back';
    this.log(
      how === 'kept'
        ? 'kept'
        : how === 'went-back'
          ? 'went back, as asked'
          : 'nothing pressed, so it went back',
    );
    if (result.ok) this.deps.ended?.(how);
    return result;
  }

  /**
   * The screens changed some other way (Uncover, a display came or went): whether an output covers the
   * controls is said again when that changed. The question and its countdown stay.
   */
  refresh(): void {
    const w = this.waiting;
    if (this.changing || !w) return;
    const covers = this.deps.coversControls();
    if (covers === w.coversControls) return;
    w.coversControls = covers;
    this.deps.changed(this.current());
  }

  /** Drashti is quitting: a change nobody kept goes back (saved only), so the next start never opens it. */
  quitting(): void {
    const waiting = this.waiting;
    if (!waiting) return;
    waiting.cancel();
    this.waiting = null;
    try {
      this.deps.restore(waiting.before, true);
      this.log('Drashti quit before an answer, so it went back');
    } catch (error) {
      this.log(
        `could not go back as Drashti quit (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
}
