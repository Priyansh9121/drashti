import type { EngineMessage } from './protocol';

/**
 * Carries engine messages from the main process to everyone who shows the
 * state. Phase 0 uses IPC to local windows; Phase 3 adds WebSocket to remote
 * Drashti Nodes. The engine only ever talks to this interface.
 */
export interface EngineTransport {
  /** Deliver a message to every current subscriber. Must not throw. */
  broadcast(message: EngineMessage): void;
}

/** Sends every message through several transports (for example IPC and WebSocket). */
export class FanoutTransport implements EngineTransport {
  constructor(private readonly transports: readonly EngineTransport[]) {}

  broadcast(message: EngineMessage): void {
    for (const t of this.transports) t.broadcast(message);
  }
}
