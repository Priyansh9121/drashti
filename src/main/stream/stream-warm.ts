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
 * back after an unexpected stop (it is on air from the start: nothing more is drawn then), never with the stream's page
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
  /** Chromium draws without a graphics chip here (null: it has not said yet; warmed, as the outputs are). */
  noGpu: boolean | null;
  /** No page warms up at this start (a test's switch, or an Intel Drashti under Rosetta). */
  warmUpsSkipped: boolean;
  /** What was on air came back after an unexpected stop (the show first: nothing more drawn). */
  showBack: boolean;
  /** The stream's page is open already: it warms itself. */
  streamOpen: boolean;
  /** Done (or decided) already at this start. */
  asked: boolean;
}

export type StreamWarmStart = { warm: true } | { warm: false; why: string };

/** Whether the stream's warm-up page opens now, or why not (for the log). */
export function streamWarmAtStart(_f: StreamWarmFacts): StreamWarmStart {
  return { warm: false, why: 'not built yet' };
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
  constructor(private readonly deps: StreamWarmDeps) {}

  /** The start has settled (every hall screen has drawn; the opening over, or not playing). */
  settled(): void {
    this.deps.log('Stream warm-up: not built yet');
  }

  /** The stream's page opened: it warms itself, and this one closes. */
  streamOpened(): void {
    // Not built yet.
  }

  /** Drashti quits. */
  stop(): void {
    // Not built yet.
  }

  /** Whether its window is open. */
  readonly open: boolean = false;
}
