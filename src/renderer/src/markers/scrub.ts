import type { EngineCommand } from '../../../shared/engine/commands';
import type { PlayingRef } from '../../../shared/engine/playing';

/*
 * Dragging the time bar under LIVE (Session 56, the owner's words of 11 Nov 2026: "Drag LIVE's time bar to move a video
 * or sound forward or back, like an ordinary player"), in Pro Mode and Simple Mode alike. As an ordinary player does, a
 * video's picture follows the finger: once the pointer held on the bar has moved, the video waits, paused (so silent),
 * at the time under it on every screen, the second computer, the stream and key and fill, a move at most every
 * SCRUB_EVERY_MS (each screen has the time to show it; none is sent more than a screen can draw); let go, it moves there
 * once more and plays on from there (paused before, it stays paused). Esc, or the pointer taken away, puts it back where
 * it would be had it never been moved. A click (a press let go with no move between) moves it once, as before. A sound
 * jumps where it is let go, as an ordinary player's sound plays on while its bar is dragged: its row has no scrub.
 * The engine's own commands (the time bar's Pause, move and Play), sent in turn: a move never lands before the Pause
 * before it.
 */

/** The least time between two moves while dragging (ms). */
export const SCRUB_EVERY_MS = 150;

export interface ScrubDeps {
  /** Send a command to the engine, settled once it is answered (operator/actions.ts dispatch). */
  send: (command: EngineCommand) => Promise<unknown>;
  /** Now, for spacing the moves (ms; any steady clock). */
  now: () => number;
  /** Run `run` after `ms`; returns how to cancel it. */
  later: (ms: number, run: () => void) => () => void;
}

/** What plays as the drag begins. */
export interface ScrubStart {
  ref: PlayingRef;
  /** Paused as the drag began (the time bar's Pause, or Music's): it stays paused where it is let go. */
  paused: boolean;
  /** Played once to its end point (ms), for one that does not go round: let go there, it holds there. */
  endMs: number | null;
  /** Where it would be now had it never been moved (ms into its file): Esc puts it back there. */
  at: () => number;
}

export class Scrub {
  private started: ScrubStart | null = null;
  /** The latest time under the finger not yet sent, and when the last move went. */
  private latest: number | null = null;
  private lastSent = Number.NEGATIVE_INFINITY;
  private cancelWait: (() => void) | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private gone = false;

  constructor(private readonly deps: ScrubDeps) {}

  /** A drag under way: what plays waits, paused, where the finger is. */
  get scrubbing(): boolean {
    return this.started !== null;
  }

  /** Paused as the drag began (null with none under way): the row shows it as it was until let go. */
  get pausedBefore(): boolean | null {
    return this.started ? this.started.paused : null;
  }

  /** The time under the finger, the pointer held and moved: the first pauses what plays, then moves follow it. */
  hold(start: () => ScrubStart, toMs: number): void {
    if (this.gone) return;
    if (!this.started) {
      this.started = start();
      if (!this.started.paused) this.queue({ type: 'pausePlaying', playing: this.started.ref });
    }
    this.latest = toMs;
    const wait = this.lastSent + SCRUB_EVERY_MS - this.deps.now();
    if (wait <= 0) {
      this.flush();
      return;
    }
    this.cancelWait ??= this.deps.later(wait, () => {
      this.cancelWait = null;
      this.flush();
    });
  }

  /**
   * Let go at `toMs` (or a click there, or a key's move): it moves there; after a drag it plays on from there, unless it
   * was paused before it (or is let go at its end point, where it holds).
   */
  letGo(ref: PlayingRef, toMs: number): void {
    if (this.gone) return;
    const started = this.end();
    this.queue({ type: 'moveTo', playing: started?.ref ?? ref, toMs });
    if (started && !started.paused && (started.endMs === null || toMs < started.endMs))
      this.queue({ type: 'resumePlaying', playing: started.ref });
  }

  /** The drag let go of with no move (Esc, the pointer taken away): back where it would be had it never moved. */
  cancel(): void {
    if (this.gone) return;
    const started = this.end();
    if (!started) return;
    this.queue({ type: 'moveTo', playing: started.ref, toMs: Math.max(0, Math.round(started.at())) });
    if (!started.paused) this.queue({ type: 'resumePlaying', playing: started.ref });
  }

  /** Its row gone (another file, another showing): nothing more is sent, not even what is waiting its turn. */
  dispose(): void {
    this.gone = true;
    this.end();
  }

  /** Its row drawn again (React's StrictMode mounts it twice in development): it sends again. */
  open(): void {
    this.gone = false;
  }

  private end(): ScrubStart | null {
    const started = this.started;
    this.cancelWait?.();
    this.cancelWait = null;
    this.started = null;
    this.latest = null;
    this.lastSent = Number.NEGATIVE_INFINITY;
    return started;
  }

  private flush(): void {
    if (!this.started || this.latest === null) return;
    this.lastSent = this.deps.now();
    this.queue({ type: 'moveTo', playing: this.started.ref, toMs: this.latest });
    this.latest = null;
  }

  /** Each command once the one before it is answered (a refused one too). */
  private queue(command: EngineCommand): void {
    this.chain = this.chain
      .then(() => (this.gone ? undefined : this.deps.send(command)))
      .catch(() => undefined);
  }
}
