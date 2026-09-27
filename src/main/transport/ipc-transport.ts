import type { EngineMessage } from '../../shared/engine/protocol';
import type { EngineTransport } from '../../shared/engine/transport';
import { IPC } from '../../shared/ipc';

/** The parts of Electron's WebContents the transport uses (easy to fake in tests). */
export interface MessageTarget {
  readonly id: number;
  send(channel: string, message: unknown): void;
  isDestroyed(): boolean;
  isCrashed(): boolean;
  once(event: 'destroyed', listener: () => void): unknown;
}

/**
 * Delivers engine messages to local windows over IPC. A window subscribes
 * once per page load; a reloaded or crashed page subscribes again and gets
 * a fresh snapshot.
 */
export class IpcTransport implements EngineTransport {
  private readonly targets = new Map<number, MessageTarget>();

  constructor(private readonly onError: (error: unknown, target: MessageTarget) => void = () => undefined) {}

  add(target: MessageTarget): void {
    if (this.targets.has(target.id)) return;
    this.targets.set(target.id, target);
    target.once('destroyed', () => {
      this.targets.delete(target.id);
    });
  }

  remove(id: number): void {
    this.targets.delete(id);
  }

  get size(): number {
    return this.targets.size;
  }

  broadcast(message: EngineMessage): void {
    for (const target of this.targets.values()) {
      if (target.isDestroyed()) {
        this.targets.delete(target.id);
        continue;
      }
      if (target.isCrashed()) continue;
      try {
        target.send(IPC.engine.message, message);
      } catch (error) {
        this.onError(error, target);
      }
    }
  }
}
