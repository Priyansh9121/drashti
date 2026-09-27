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

let started = false;

/**
 * Subscribe this window to the engine. Messages are applied as they arrive;
 * a gap triggers a fresh snapshot. Safe to call more than once.
 */
export function connectEngine(): void {
  if (started) return;
  started = true;
  const mirror = new EngineMirror();
  const publish = (message: EngineMessage) => {
    useEngine.setState({ state: mirror.state, rev: mirror.rev, sentAt: message.sentAt, connected: true });
  };
  const receive = (message: EngineMessage) => {
    const result = mirror.apply(message);
    if (result === 'applied') publish(message);
    else if (result === 'resync') void window.drashti.engine.snapshot().then(receive);
  };
  window.drashti.engine.onMessage(receive);
  void window.drashti.engine.subscribe().then(receive);
}
