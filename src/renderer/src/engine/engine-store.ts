import { create } from 'zustand';
import { EngineMirror } from '../../../shared/engine/mirror';
import type { EngineMessage } from '../../../shared/engine/protocol';
import type { EngineState } from '../../../shared/engine/state';
import { noteShowChange } from './show-changed';

interface EngineView {
  state: EngineState | null;
  rev: number;
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

/**
 * Keep this page's copy of the engine state from a source. Messages are
 * applied as they arrive; a gap asks for a fresh snapshot. Once per page.
 */
export function connectEngineSource(source: EngineSource): void {
  if (started) return;
  started = true;
  const mirror = new EngineMirror();
  source.onMessage((message) => {
    const result = mirror.apply(message);
    if (result === 'applied') {
      noteShowChange();
      useEngine.setState({
        state: mirror.state,
        rev: mirror.rev,
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
export function connectEngine(kind: keyof typeof ENGINE_ASK_EVERY_MS = 'says'): void {
  if (started) return;
  let receive: ((message: EngineMessage) => void) | null = null;
  connectEngineSource({
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
  });
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
