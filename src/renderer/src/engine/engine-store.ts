import { create } from 'zustand';
import { EngineMirror } from '../../../shared/engine/mirror';
import type { EngineMessage } from '../../../shared/engine/protocol';
import type { EngineState } from '../../../shared/engine/state';

interface EngineView {
  state: EngineState | null;
  rev: number;
  /** Wall-clock time the last applied message left the main process. */
  sentAt: number;
  connected: boolean;
}

/** This window's copy of the show engine state. */
export const useEngine = create<EngineView>(() => ({ state: null, rev: -1, sentAt: 0, connected: false }));

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
    if (result === 'applied')
      useEngine.setState({ state: mirror.state, rev: mirror.rev, sentAt: message.sentAt, connected: true });
    else if (result === 'resync') source.resync();
  });
}

/** Subscribe this window to the engine over IPC. Safe to call more than once. */
export function connectEngine(): void {
  if (started) return;
  let receive: ((message: EngineMessage) => void) | null = null;
  connectEngineSource({
    onMessage: (listener) => {
      receive = listener;
      window.drashti.engine.onMessage(listener);
    },
    resync: () => {
      void window.drashti.engine.snapshot().then((m) => receive?.(m));
    },
  });
  void window.drashti.engine.subscribe().then((m) => receive?.(m));
}
