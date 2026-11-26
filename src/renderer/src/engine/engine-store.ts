import { create } from 'zustand';
import { EngineMirror } from '../../../shared/engine/mirror';
import type { EngineMessage } from '../../../shared/engine/protocol';
import type { EngineState } from '../../../shared/engine/state';
import { noteShowChange } from './show-changed';

interface EngineView {
  state: EngineState | null;
  rev: number;
  /** Revision of the state published for rendering (operator cleanup may wait briefly). */
  drawnRev: number;
  /**
   * The run of the engine `rev` counts in (Session 53): each run starts again from 0, so a phone's Next says both.
   * Undefined until a snapshot says it.
   */
  session?: string;
  /** Wall-clock time the last applied message left the main process. */
  sentAt: number;
  connected: boolean;
  /**
   * The show's state could not be read (Session 39): asked for again by itself after 1, 2 and 5 s, then
   * said in the operator window with Try again, until it arrives. Next, Back and the clears wait for it.
   */
  unread: boolean;
}

/** This window's copy of the show engine state. */
export const useEngine = create<EngineView>(() => ({
  state: null,
  rev: -1,
  drawnRev: -1,
  sentAt: 0,
  connected: false,
  unread: false,
}));

/** How long after each failed ask for the show's state the window asks again by itself (Session 39). */
export const ENGINE_RETRY_MS: readonly number[] = [1000, 2000, 5000];
/** An ask that has not answered by then counts as failed. */
export const ENGINE_ANSWER_MS = 10_000;
/** After those, how often it goes on asking: the operator window, which says so; a page that can't. */
export const ENGINE_ASK_EVERY_MS = { says: 30_000, silent: 5000 } as const;

/** Where engine messages come from: a window's IPC, or (on a phone or tablet) the network's feed. */
export interface EngineSource {
  onMessage(listener: (message: EngineMessage) => void): void;
  /** A revision went missing: ask for the whole state again (it arrives as a message). */
  resync(): void;
}

let started = false;

export interface EngineConnectionOptions {
  /** Operator only: a videoStart-only cleanup is bookkeeping, not a show change at Go. */
  deferCueCleanup?: boolean;
}

/**
 * Apply every message to the mirror immediately; a gap asks for a fresh snapshot. The operator may defer
 * publishing only Go cleanup to its render subscribers. Protocol revisions always advance immediately.
 */
export function connectEngineSource(source: EngineSource, options: EngineConnectionOptions = {}): void {
  if (started) return;
  started = true;
  const mirror = new EngineMirror();
  let cleanup: ReturnType<typeof setTimeout> | null = null;
  const publish = () => {
    cleanup = null;
    noteShowChange();
    useEngine.setState({ state: mirror.state, drawnRev: mirror.rev });
  };
  source.onMessage((message) => {
    const start = mirror.state?.videoStart;
    const result = mirror.apply(message);
    if (result === 'applied') {
      if (cleanup !== null) clearTimeout(cleanup);
      cleanup = null;
      const wait = start ? start.at + 250 - Date.now() : 0;
      const op = message.kind === 'patch' && message.ops.length === 1 ? message.ops[0] : undefined;
      const defer =
        options.deferCueCleanup &&
        start &&
        Date.now() >= start.at &&
        wait > 0 &&
        op?.path.length === 1 &&
        op.path[0] === 'videoStart' &&
        op.value === null;
      if (defer) {
        // Bounded operator-only bookkeeping publication; playback still uses the shared clock.
        cleanup = setTimeout(publish, wait);
      } else {
        noteShowChange();
      }
      useEngine.setState({
        ...(defer ? {} : { state: mirror.state, drawnRev: mirror.rev }),
        rev: mirror.rev,
        session: mirror.session,
        sentAt: message.sentAt,
        connected: true,
        unread: false,
      });
    } else if (result === 'resync') source.resync();
  });
}

let askAgain: (() => void) | null = null;

/** Try again (Session 39): ask for the show's state once more, at once. */
export function readEngineAgain(): void {
  askAgain?.();
}

/**
 * Subscribe this window to the engine over IPC. Safe to call more than once. A page that shows no words (an
 * output, the stream's picture, the audio player) says nothing when the state can't be read, and asks more
 * often.
 */
export function connectEngine(
  kind: keyof typeof ENGINE_ASK_EVERY_MS = 'says',
  options: EngineConnectionOptions = {},
): void {
  if (started) return;
  let receive: ((message: EngineMessage) => void) | null = null;
  connectEngineSource(
    {
      onMessage: (listener) => {
        receive = listener;
        window.drashti.engine.onMessage(listener);
      },
      resync: () => {
        window.drashti.engine.snapshot().then(
          (m) => receive?.(m),
          () => undefined,
        );
      },
    },
    options,
  );
  // Asked for until it comes (Session 39): again by itself after 1, 2 and 5 s, then said (the operator
  // window, with Try again) and asked for now and then. An ask that never answers counts as failed.
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const ask = (): void => {
    if (retry !== null) clearTimeout(retry);
    retry = null;
    let settled = false;
    const failed = () => {
      if (settled || useEngine.getState().connected) return;
      settled = true;
      const wait = ENGINE_RETRY_MS[failures];
      failures += 1;
      if (wait === undefined) useEngine.setState({ unread: true });
      retry = setTimeout(ask, wait ?? ENGINE_ASK_EVERY_MS[kind]);
    };
    const late = setTimeout(failed, ENGINE_ANSWER_MS);
    window.drashti.engine.subscribe().then(
      (m) => {
        settled = true;
        clearTimeout(late);
        receive?.(m);
      },
      () => {
        clearTimeout(late);
        failed();
      },
    );
  };
  askAgain = ask;
  ask();
}
