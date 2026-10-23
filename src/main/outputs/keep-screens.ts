import type { PendingScreens } from '../../shared/keep-screens';
import { KEEP_SCREENS_MS } from '../../shared/keep-screens';
import type { ScreenStatus, ScreensResult, ScreensSnapshot } from '../../shared/screens';

/*
 * Keep these screens? (Session 50; Priyansh: in Set Up Screens… he chose the display his controls are on as the
 * audience picture by mistake, and couldn't get back). After a change that puts an output on a display (Set Up
 * Screens…'s Done or Finish, Show on, Screens' Use this display and On), Drashti asks for 15 s, with Keep and Go
 * back. Nothing pressed, it goes back by itself to the screens as they were: the setup is taken just before and
 * just after the change, and Go back undoes only what the change changed (Session 51, screens-setup.ts), so
 * whatever else changed meanwhile stays. Turning an output off asks nothing. A second change while one waits is
 * added to the first, so Go back returns to the screens before both, and its countdown starts again; a change
 * that puts nothing new on a display while one waits (an output turned off, a screen renamed) asks nothing, and
 * stays as it is when Go back undoes the ones asked about (Session 51's review).
 * Quitting while one waits goes back too, so the next start never opens a change nobody kept; and the changes
 * waiting are kept on disk until answered (Session 51, S3-2), so after a crash or a power cut the next start
 * goes back to the screens as they were before them.
 */

/** What each display shows: for each display with an output on it, which screen, of which group and role. */
export type Placed = ReadonlyMap<string, string>;

/**
 * How a question ended: kept, gone back (Go back, Esc), gone back by itself (nothing pressed in time), or a Go back
 * that failed (the screens stay as changed, and the question goes all the same).
 */
export type KeepEnding = 'kept' | 'went-back' | 'went-back-by-itself' | 'could-not-go-back';

/** One change: the screen setup just before it, and just after. */
export interface Change<S> {
  before: S;
  after: S;
}

export interface KeepScreensDeps<S> {
  /** A change begins with none waiting: what going back returns to begins here (where the controls are). */
  starting?(): void;
  /** The screen setup now, taken just before and just after each change. */
  capture(): S;
  /**
   * Undo the changes, the last first, each only where it is still as it left the screens. `quitting`: Drashti is
   * quitting, so it is only saved (no window opens or closes).
   */
  restore(changes: readonly Change<S>[], quitting: boolean): ScreensResult;
  /** What each display shows now. */
  placed(): Placed;
  /** An output covers the controls now: it asks the same, large, in its middle. */
  coversControls(): boolean;
  /** The screens as they are, for Keep's answer. */
  snapshot(): ScreensSnapshot;
  /** The change waiting for an answer changed (null: answered, or gone back). */
  changed(pending: PendingScreens | null): void;
  /**
   * The changes waiting for an answer, kept on disk until it comes (null: answered, gone back, or Drashti quit and
   * went back: cleared), so a crash or a power cut meanwhile goes back at the next start. One that cannot be kept,
   * or cleared, is said in the log; the question goes on.
   */
  remember?(changes: readonly Change<S>[] | null): void;
  /** A question ended: the operator is told when the screens went back, or could not (whoever answered). */
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

/** Where the controls were when a change began: their display, and the operator window's place there. */
export interface ControlsPlace<B> {
  displayId: number | null;
  bounds: B | null;
}

/**
 * Where to put the operator window back after going back (Session 50, section 3's review): a change that puts an
 * output on the controls' display moves them to a free display if there is one; going back puts them where they
 * were, unless they are there already or that display has gone. Null: leave them.
 */
export function controlsToPutBack<B>(
  before: ControlsPlace<B> | null,
  displays: readonly number[],
  nowDisplayId: number | null,
): B | null {
  if (!before?.bounds || before.displayId === null) return null;
  if (!displays.includes(before.displayId) || before.displayId === nowDisplayId) return null;
  return before.bounds;
}

/** What the operator is told when going back failed (the screens stay as changed). */
export const COULD_NOT_GO_BACK =
  'Drashti could not put the screens back as they were. Change them in Screens.';

interface Waiting<S> {
  /** The changes it asks about, the first first: Go back undoes them all. */
  changes: Change<S>[];
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

  private remember(changes: readonly Change<S>[] | null): void {
    try {
      this.deps.remember?.(changes);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      this.log(
        changes
          ? `could not keep the change on disk (${why})`
          : `could not clear the change kept on disk (${why}): the next start may go back over it`,
      );
    }
  }

  /** The change waiting for Keep or Go back, or null. */
  current(): PendingScreens | null {
    const w = this.waiting;
    return w ? { deadline: w.deadline, coversControls: w.coversControls } : null;
  }

  /** Make a screen change; one that puts an output on a display then waits for Keep or Go back. */
  change(run: () => ScreensResult): ScreensResult {
    if (this.deps.asks === false) return run();
    if (!this.waiting) this.deps.starting?.();
    const before = this.deps.capture();
    const was = this.deps.placed();
    this.changing = true;
    let result: ScreensResult;
    try {
      result = run();
    } finally {
      this.changing = false;
    }
    if (!result.ok) return result;
    // Something new on a display asks; anything else is no question, nor one Go back undoes (a countdown goes on).
    if (putsOutputOn(was, this.deps.placed())) this.ask({ before, after: this.deps.capture() });
    else this.refresh();
    return result;
  }

  private ask(made: Change<S>): void {
    // With one waiting, Go back undoes both.
    const changes = [...(this.waiting?.changes ?? []), made];
    this.waiting?.cancel();
    const ms = this.deps.waitMs ?? KEEP_SCREENS_MS;
    const cancel = (this.deps.later ?? realLater)(() => {
      this.answer(false, true);
    }, ms);
    const coversControls = this.deps.coversControls();
    this.waiting = { changes, deadline: this.now() + ms, coversControls, cancel };
    this.remember(changes);
    this.log(
      `asked, ${String(Math.round(ms / 1000))} s to answer${coversControls ? ', an output over the controls asking too' : ''}`,
    );
    this.deps.changed(this.current());
  }

  /** Keep the change. */
  keep(): ScreensResult {
    return this.answer(true, false);
  }

  /** Go back to the screens as they were before the change: only what it changed goes back. */
  goBack(): ScreensResult {
    return this.answer(false, false);
  }

  private answer(keep: boolean, byItself: boolean): ScreensResult {
    const waiting = this.waiting;
    if (!waiting) return { ok: false, message: 'No screen change is waiting for an answer now.' };
    waiting.cancel();
    this.waiting = null;
    let result: ScreensResult;
    let how: KeepEnding = keep ? 'kept' : byItself ? 'went-back-by-itself' : 'went-back';
    try {
      result = keep
        ? { ok: true, snapshot: this.deps.snapshot() }
        : this.deps.restore(waiting.changes, false);
    } catch (error) {
      this.log(`could not go back (${error instanceof Error ? error.message : String(error)})`);
      how = 'could-not-go-back';
      result = { ok: false, message: COULD_NOT_GO_BACK };
    }
    // Answered: nothing waits on disk (a Go back that failed too: the operator is told to change them in Screens).
    this.remember(null);
    // After the screens are back: the operator window has them as they were by the time the question goes.
    this.deps.changed(null);
    if (how !== 'could-not-go-back')
      this.log(
        how === 'kept'
          ? 'kept'
          : how === 'went-back'
            ? 'went back, as asked'
            : 'nothing pressed, so it went back',
      );
    this.deps.ended?.(how);
    return result;
  }

  /**
   * The screens changed some other way (Uncover, a display came or went, a change that asks nothing): whether an
   * output covers the controls is said again when that changed. The question and its countdown stay.
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
      this.deps.restore(waiting.changes, true);
      this.remember(null);
      this.log('Drashti quit before an answer, so it went back');
    } catch (error) {
      // Still on disk: the next start goes back.
      this.log(
        `could not go back as Drashti quit (${error instanceof Error ? error.message : String(error)}); the next start goes back`,
      );
    }
  }
}
