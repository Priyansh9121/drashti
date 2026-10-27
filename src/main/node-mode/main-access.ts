import { ACCESS_STOP_AFTER_MS } from '../../shared/access-protocol';

/*
 * A node runs only while paired with a Main that is let in (Session 54, access by Gmail). Main says whether it is
 * as the node connects, at each change and every 15 s. Told it is not, the node's screens go black at once; hearing
 * nothing of it for 2 minutes (Main quit, or its network gone), the same. A node that starts while Main is away shows
 * the last picture it kept (Session 13) for those 2 minutes too, as Main's own 2 minutes keep a show going through a
 * blip, then black. Hearing a Main let in again, the node shows what Main shows: a node has no controls of its own,
 * so there is nothing for it to keep stopped (Main itself stops for good). The 2 minutes are on the timers' own
 * clock: a changed computer clock moves nothing.
 */

export type NodeStopWhy =
  /** Main said it is not let in (revoked, rejected, unknown, or its own 2 minutes with no answer). */
  | 'main-stopped'
  /** No Main let in heard: since the node started, or for 2 minutes. */
  | 'not-heard';

export class MainAccess {
  private why: NodeStopWhy | null = null;
  /** When the screens went black, by the engine's time: they fade from then. */
  private at = 0;
  private cancel: (() => void) | null = null;

  constructor(
    private readonly o: {
      /** The engine's time on this node (Main's clock, as the node keeps in step with it). */
      engineNow: () => number;
      setTimer: (ms: number, run: () => void) => () => void;
      /** The screens stop or show again: they are told. */
      changed: () => void;
      log: (message: string) => void;
      graceMs?: number;
    },
  ) {
    this.wait();
  }

  /** What Main said. */
  heard(letIn: boolean): void {
    if (!letIn) {
      this.goBlack('main-stopped');
      return;
    }
    this.wait();
    if (this.why === null) return;
    this.o.log('Node: Main is let in: the screens show its show');
    this.why = null;
    this.o.changed();
  }

  /** Why the screens are black, or null while they show. */
  get stopped(): NodeStopWhy | null {
    return this.why;
  }

  /** The engine state's stop to draw (the screens fade from `at`), or null while they show. */
  get stop(): { at: number } | null {
    return this.why === null ? null : { at: this.at };
  }

  dispose(): void {
    this.cancel?.();
    this.cancel = null;
  }

  /** The 2 minutes from now, until Main is heard again. */
  private wait(): void {
    this.cancel?.();
    this.cancel = this.o.setTimer(this.o.graceMs ?? ACCESS_STOP_AFTER_MS, () => {
      this.cancel = null;
      this.goBlack('not-heard');
    });
  }

  private goBlack(why: NodeStopWhy): void {
    this.cancel?.();
    this.cancel = null;
    if (this.why === why) return;
    if (this.why === null) {
      this.at = this.o.engineNow();
      this.o.log(
        why === 'main-stopped'
          ? 'Node: Main is not let in: the screens go black'
          : 'Node: no Main let in heard for 2 minutes: the screens go black',
      );
    }
    this.why = why;
    this.o.changed();
  }
}
