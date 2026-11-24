/*
 * Waking the waiting saves when what plays has played to its end (alpha.23, the save-trim review's SHOULD-2). A save
 * the operator asked for waits while a video or a sound plays (shared/save-waits.ts), and one that does not go round
 * stops playing at its end point by itself. When its last picture stays up (When it ends → Freeze, no wallpaper
 * chosen, a slide or the box over it), nothing changes on LIVE then, so nothing would tell the saves that only look
 * again at a change: a row's Trim checks and carries on its cut only then (main/convert/playlist-trims.ts). This waits
 * for that moment and wakes them. ConvertService and EditService look every second as well.
 */

export interface SaveWakeDeps {
  /** The next moment something playing stops holding a save by itself (shared/save-waits.ts saveWaitEndsAt), or null. */
  endsAt(): number | null;
  /** The engine's clock. */
  now(): number;
  /** Tell the waiting saves to look again. */
  wake(): void;
  /** Tests: timers of their own. */
  schedule?: (ms: number, run: () => void) => () => void;
}

function afterMs(ms: number, run: () => void): () => void {
  const timer = setTimeout(run, ms);
  timer.unref();
  return () => {
    clearTimeout(timer);
  };
}

export class SaveWake {
  private waiting: { at: number; cancel: () => void } | null = null;
  private closed = false;

  constructor(private readonly deps: SaveWakeDeps) {}

  /** What plays changed (or a wake came): wait for the next end again, when it moved. */
  changed(): void {
    if (this.closed) return;
    const at = this.deps.endsAt();
    if (at === (this.waiting?.at ?? null)) return;
    this.waiting?.cancel();
    this.waiting = null;
    if (at === null) return;
    const cancel = (this.deps.schedule ?? afterMs)(Math.max(0, at - this.deps.now()), () => {
      if (this.waiting?.at !== at) return;
      this.waiting = null;
      // A timer can come a moment early (its clock and the engine's differ by a millisecond or so): then nothing has
      // ended yet, so it only waits again for what is left.
      if (this.deps.now() >= at) this.deps.wake();
      this.changed();
    });
    this.waiting = { at, cancel };
  }

  close(): void {
    this.closed = true;
    this.waiting?.cancel();
    this.waiting = null;
  }
}
