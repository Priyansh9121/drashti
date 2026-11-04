/*
 * Whether the opening plays as Drashti starts (Session 55, the owner's brief of 3 Nov 2026, shared/opening.ts): once,
 * when a person starts Drashti, on Main's operator window. Never when Drashti starts again by itself or for a reason
 * of its own: after an unexpected stop (a crash, the watchdog's restart, a computer switched off with Drashti open:
 * the show comes back first, and the recovery figure is as it was), after a restore, at the first start of a new
 * version (an update's), or when the operator window's page is loaded again (the watchdog's reload, Reload Operator
 * Window). Never on a node, in a self-test, or in a test that does not ask for it (DRASHTI_TEST_OPENING=1). Never
 * with the first start's welcome or Simple Mode's first steps: they come instead. And only as the window opens: asked
 * for later (a computer let in a while after it started), it does not play.
 *
 * While it plays, any key ends it at once, and the main process keeps that key from the page and the menu
 * (before-input-event), its repeats and its release too, so Space never puts up the next slide.
 */

/** Asked for this long after the operator window was made, it does not play (only at the start). */
export const OPENING_LATEST_MS = 60_000;

/** What decides it, as this start finds it. */
export interface OpeningStartFacts {
  /** This computer is a node (no operator window of its own). */
  node: boolean;
  /** A self-test runs (DRASHTI_SELFTEST). */
  selfTest: boolean;
  /** A test runs (any DRASHTI_TEST_* switch) and did not ask for the opening (DRASHTI_TEST_OPENING=1). */
  testNotAsking: boolean;
  /** The last run quit on purpose. */
  cleanQuit: boolean;
  /** A backup was restored at this start. */
  restored: boolean;
  /** The version that last started with this library (null: none said so yet), and this one. */
  lastVersion: string | null;
  version: string;
  /** The first start's welcome, or Simple Mode's first steps, show at this start. */
  welcome: boolean;
  /** Switched on in File › Opening…. */
  on: boolean;
  /** The operator window's page was loaded again, or its process ended, since the start. */
  pageAgain: boolean;
  /** Played (or not) already at this start. */
  asked: boolean;
  /** How long after the operator window was made it is asked for (ms). */
  sinceWindow: number;
}

export type OpeningStart = { play: true } | { play: false; why: string };

/** Whether it plays, or why not (for the log: never the words or the photos). */
export function openingAtStart(f: OpeningStartFacts): OpeningStart {
  const not = (why: string): OpeningStart => ({ play: false, why });
  if (f.node) return not('on a node');
  if (f.selfTest) return not('in a self-test');
  if (f.testNotAsking) return not('in a test that does not ask for it');
  if (f.asked) return not('it has played already at this start');
  if (f.pageAgain) return not('the operator window was loaded again');
  if (!f.cleanQuit) return not('after an unexpected stop');
  if (f.restored) return not('after a restore');
  if (f.lastVersion !== f.version) return not(`at the first start of ${f.version}`);
  if (f.welcome) return not('the first start’s welcome comes instead');
  if (!f.on) return not('turned off in File › Opening…');
  if (f.sinceWindow > OPENING_LATEST_MS) return not('asked for too long after the start');
  return { play: true };
}

/** A key as Electron's before-input-event gives it. */
export interface KeyInput {
  type: string;
  code: string;
  key: string;
  isAutoRepeat: boolean;
}

/**
 * The keys while the opening plays: the first key down ends it, and every key until then is kept from the page and
 * the menu; the key that ended it stays kept while it is held (its repeats, and its release if it is told: Chromium
 * drops the release of a key kept from the page), so the show hears only a key pressed after it.
 */
export class OpeningKeys {
  private playing = false;
  private readonly held = new Set<string>();

  constructor(private readonly ended: () => void) {}

  /** It has started: keys are its own. */
  start(): void {
    this.playing = true;
  }

  /** It ended by itself, or a click or a tap ended it: keys are the show's (a key that ended it stays kept until released). */
  stop(): void {
    this.playing = false;
  }

  /** The page was loaded again, or its process ended: nothing is kept any more. */
  reset(): void {
    this.playing = false;
    this.held.clear();
  }

  /** True: the key is the opening's, kept from the page and the menu. */
  take(input: KeyInput): boolean {
    const code = input.code === '' ? input.key : input.code;
    if (this.playing) {
      if (input.type === 'keyDown' || input.type === 'rawKeyDown') {
        this.playing = false;
        this.held.add(code);
        this.ended();
      }
      return true;
    }
    if (!this.held.has(code)) return false;
    // Pressed again (not a repeat): it was let go, though its release was never told. The show's.
    if ((input.type === 'keyDown' || input.type === 'rawKeyDown') && !input.isAutoRepeat) {
      this.held.delete(code);
      return false;
    }
    if (input.type === 'keyUp') this.held.delete(code);
    return true;
  }
}
