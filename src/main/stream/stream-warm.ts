/*
 * The stream's page's warm-up at Drashti's start (Session 59, X21; C19's finding, C25). The stream's page is drawn off
 * screen in a window of its own kind (stream/program-window.ts), and the drawing pipelines its warm-up makes are its
 * own: none of the hall's screens' warm-ups made them. Made on air (the Stream panel's preview opened while a deck
 * plays), each one held the graphics chip, and the hall's screens' frames stalled with it (CI's Mac: 0.5-2.3 s). So,
 * once Drashti's start has settled (every hall screen has drawn, and the opening is over or does not play), Main opens
 * the stream's warm-up page alone in a window like the stream's (createStreamWarmWindow): the same warm-up, under the
 * same black, never seen; done (or at STREAM_WARM_CAP_MS), it closes. The chip keeps the pipelines for every window
 * after, so the stream's page opened later makes none, and its own warm-up draws in moments.
 *
 * Never where Chromium draws without a graphics chip (no warm-up anywhere: nothing to make), never when the show comes
 * back after an unexpected stop or anything is on air already (nothing more is drawn then), never with the stream's page
 * already open (it warms itself: this one closes), never on a node or in a self-test, and in a test only when it asks
 * (DRASHTI_TEST_STREAM_WARM=1).
 */

/** What decides it, as the start has settled. */
export interface StreamWarmFacts {
  /** This computer is a node (no stream of its own). */
  node: boolean;
  /** A self-test runs (DRASHTI_SELFTEST). */
  selfTest: boolean;
  /** A test runs (any DRASHTI_TEST_* switch) and did not ask for it (DRASHTI_TEST_STREAM_WARM=1). */
  testNotAsking: boolean;
  /** Chromium draws without a graphics chip here (null: it has not said yet, and it waits until it has: gpuSaid()). */
  noGpu: boolean | null;
  /** No page warms up at this start (a test's switch, or an Intel Drashti under Rosetta). */
  warmUpsSkipped: boolean;
  /** What was on air came back after an unexpected stop (the show first: nothing more drawn). */
  showBack: boolean;
  /** The stream's page is open already: it warms itself. */
  streamOpen: boolean;
  /** Something is on air already (on the screens, or the stream or a recording): nothing more is drawn then. */
  onAir: boolean;
  /** Done (or decided) already at this start. */
  asked: boolean;
}

export type StreamWarmStart = { warm: true } | { warm: false; why: string };

/** Whether the stream's warm-up page opens now, or why not (for the log). */
export function streamWarmAtStart(f: StreamWarmFacts): StreamWarmStart {
  const not = (why: string): StreamWarmStart => ({ warm: false, why });
  if (f.asked) return not('it has been done at this start');
  if (f.node) return not('on a node');
  if (f.selfTest) return not('in a self-test');
  if (f.testNotAsking) return not('in a test that does not ask for it');
  if (f.noGpu === true) return not('Chromium draws without a graphics chip');
  if (f.warmUpsSkipped) return not('no page warms up at this start');
  if (f.showBack) return not('the show came back after an unexpected stop');
  if (f.streamOpen) return not('the stream’s page is open: it warms itself');
  if (f.onAir) return not('something is on air already');
  return { warm: true };
}

/** The longest it stays open: the warm-up's cap (8 s), its last step (6 s) and the page's loading, with room. */
export const STREAM_WARM_CAP_MS = 20_000;

/** The warm-up window, as Main makes it. */
export interface StreamWarmWindow {
  destroy(): void;
  isDestroyed(): boolean;
}

export interface StreamWarmDeps {
  facts: () => StreamWarmFacts;
  /** Make the window and load its page; `done` once its warm-up is over. */
  open: (done: () => void) => StreamWarmWindow;
  log: (line: string) => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => { cancel(): void };
}

/** Runs it once at a start: settled() when the start has settled, streamOpened() when the stream's page opens. */
export class StreamWarm {
  /** Decided (or done) at this start: never again. */
  private asked = false;
  private win: StreamWarmWindow | null = null;
  private cap: { cancel(): void } | null = null;
  private since = 0;
  /** Settled before Chromium said how it draws: it decides once it has. */
  private waitingForGpu = false;

  constructor(private readonly deps: StreamWarmDeps) {}

  /** The start has settled (every hall screen has drawn; the opening over, or not playing). */
  settled(): void {
    if (this.asked) return;
    const facts = this.deps.facts();
    // Never in software on a computer without a chip before Chromium has said so: it waits for its word.
    if (facts.noGpu === null) {
      if (!this.waitingForGpu) this.deps.log('Stream warm-up: waits for Chromium to say how it draws');
      this.waitingForGpu = true;
      return;
    }
    this.waitingForGpu = false;
    const start = streamWarmAtStart(facts);
    this.asked = true;
    if (!start.warm) {
      this.deps.log(`Stream warm-up: not at this start (${start.why})`);
      return;
    }
    this.since = this.deps.now();
    this.deps.log('Stream warm-up: the stream’s page’s warm-up, alone, off screen');
    this.cap = this.deps.setTimer(() => {
      this.close('closed at its cap');
    }, STREAM_WARM_CAP_MS);
    this.win = this.deps.open(() => {
      this.close('done');
    });
  }

  /** Chromium's GPU process has said how it draws: a start that settled before then decides now. */
  gpuSaid(): void {
    if (this.waitingForGpu) this.settled();
  }

  /** The stream's page opened: it warms itself, and this one closes (or never opens). */
  streamOpened(): void {
    if (!this.asked) {
      this.asked = true;
      this.deps.log('Stream warm-up: not at this start (the stream’s page is open: it warms itself)');
      return;
    }
    this.close('closed: the stream’s page opened');
  }

  /** Drashti quits. */
  stop(): void {
    this.asked = true;
    this.close(null);
  }

  /** Whether its window is open. */
  get open(): boolean {
    return this.win !== null && !this.win.isDestroyed();
  }

  private close(how: string | null): void {
    this.cap?.cancel();
    this.cap = null;
    const win = this.win;
    this.win = null;
    if (!win) return;
    if (!win.isDestroyed()) win.destroy();
    if (how)
      this.deps.log(`Stream warm-up: ${how} in ${((this.deps.now() - this.since) / 1000).toFixed(1)} s`);
  }
}
