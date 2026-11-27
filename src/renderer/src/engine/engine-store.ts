import { create } from 'zustand';
import { EngineMirror } from '../../../shared/engine/mirror';
import type { EngineMessage } from '../../../shared/engine/protocol';
import type { EngineState } from '../../../shared/engine/state';
import { whenCueStarted } from '../render/cue-started';
import { noteShowChange } from './show-changed';

interface EngineView {
  /** Drawing snapshot; imperative show decisions use getCurrentEngineState() instead. */
  state: EngineState | null;
  /** LIVE alone receives the Go state immediately; the window's other render subscribers wait behind its picture. */
  liveState: EngineState | null;
  liveRev: number;
  rev: number;
  /** Revision published for window-wide drawing (operator Go and cleanup may wait behind LIVE). */
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
  liveState: null,
  liveRev: -1,
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
let currentMirror: EngineMirror | null = null;

/**
 * The current engine snapshot for imperative show decisions, including Go cleanup. Drawing and LIVE may still
 * hold older snapshots. Before a source is connected there is no deferred publication: the window's copy is current.
 */
export function getCurrentEngineState(): EngineState | null {
  return currentMirror ? currentMirror.state : useEngine.getState().state;
}

export interface EngineConnectionOptions {
  /** Operator only: LIVE receives Go immediately; other drawing and Go cleanup wait behind its first frame. */
  deferCueCleanup?: boolean;
}

/**
 * Apply every message to the mirror immediately; a gap asks for a fresh snapshot. LIVE receives its armed Go at
 * once. Other operator drawing waits for LIVE's first moving frame (Go + 250 ms at most); a subsequent real change
 * cancels that wait and publishes immediately. Protocol revisions always advance immediately.
 */
export function connectEngineSource(source: EngineSource, options: EngineConnectionOptions = {}): void {
  if (started) return;
  started = true;
  const mirror = new EngineMirror();
  currentMirror = mirror;
  let pending: { id: string; cancel: () => void } | null = null;
  const cancelPending = () => {
    const held = pending;
    pending = null;
    held?.cancel();
  };
  const publish = () => {
    cancelPending();
    noteShowChange();
    useEngine.setState({
      state: mirror.state,
      drawnRev: mirror.rev,
      liveState: mirror.state,
      liveRev: mirror.rev,
    });
  };
  source.onMessage((message) => {
    const before = mirror.state;
    const start = before?.videoStart;
    const result = mirror.apply(message);
    if (result === 'applied') {
      const now = Date.now();
      const next = mirror.state;
      const armed = next?.videoStart;
      const bg = next?.layers.background;
      const deferGo = Boolean(
        options.deferCueCleanup &&
        message.kind === 'patch' &&
        armed &&
        armed.at > now &&
        before?.videoCue?.id === armed.id &&
        bg?.kind === 'media' &&
        bg.media === 'video' &&
        bg.cueId === armed.id &&
        !next.stopped &&
        !next.blackout &&
        !next.wallpaper,
      );
      const op = message.kind === 'patch' && message.ops.length === 1 ? message.ops[0] : undefined;
      const deferCleanup = Boolean(
        options.deferCueCleanup &&
        start &&
        now >= start.at &&
        now < start.at + 250 &&
        op?.path.length === 1 &&
        op.path[0] === 'videoStart' &&
        op.value === null,
      );
      // Main's bookkeeping at Go must neither redraw LIVE nor replace its first-frame wait with another timer.
      const keepPending = deferCleanup && pending?.id === start?.id;
      if (!keepPending) cancelPending();
      const defer = deferGo || deferCleanup;
      if (!defer || deferGo) noteShowChange();
      useEngine.setState({
        ...(defer ? {} : { state: next, drawnRev: mirror.rev }),
        ...(deferCleanup ? {} : { liveState: next, liveRev: mirror.rev }),
        rev: mirror.rev,
        session: mirror.session,
        sentAt: message.sentAt,
        connected: true,
        unread: false,
      });
      const held = deferGo ? armed : deferCleanup ? start : null;
      if (held && !keepPending) {
        const timer = setTimeout(publish, Math.max(0, held.at + 250 - now));
        let stopShown: () => void = () => undefined;
        pending = {
          id: held.id,
          cancel: () => {
            clearTimeout(timer);
            stopShown();
          },
        };
        // The sign is cached, so even a frame told during the LIVE publication above releases this at once.
        if (deferGo) stopShown = whenCueStarted(held.id, publish, 'shown');
      }
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
