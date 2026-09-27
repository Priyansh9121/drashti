import { describe, expect, it } from 'vitest';
import { type EngineMessage } from '../../shared/engine/protocol';
import { initialEngineState } from '../../shared/engine/state';
import { IPC } from '../../shared/ipc';
import { IpcTransport, type MessageTarget } from './ipc-transport';

class FakeTarget implements MessageTarget {
  sent: [string, unknown][] = [];
  destroyed = false;
  crashed = false;
  throws = false;
  private onDestroyed: (() => void) | null = null;
  constructor(readonly id: number) {}
  send(channel: string, message: unknown): void {
    if (this.throws) throw new Error('send failed');
    this.sent.push([channel, message]);
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }
  isCrashed(): boolean {
    return this.crashed;
  }
  once(_event: 'destroyed', listener: () => void): void {
    this.onDestroyed = listener;
  }
  destroy(): void {
    this.destroyed = true;
    this.onDestroyed?.();
  }
}

const message: EngineMessage = {
  kind: 'snapshot',
  version: 1,
  rev: 0,
  state: initialEngineState(),
  sentAt: 0,
};

describe('IpcTransport', () => {
  it('sends to every subscribed window on the engine channel', () => {
    const t = new IpcTransport();
    const a = new FakeTarget(1);
    const b = new FakeTarget(2);
    t.add(a);
    t.add(b);
    t.add(a);
    t.broadcast(message);
    expect(a.sent).toEqual([[IPC.engine.message, message]]);
    expect(b.sent).toHaveLength(1);
    expect(t.size).toBe(2);
  });

  it('forgets destroyed windows', () => {
    const t = new IpcTransport();
    const a = new FakeTarget(1);
    t.add(a);
    a.destroy();
    t.broadcast(message);
    expect(t.size).toBe(0);
    expect(a.sent).toHaveLength(0);
  });

  it('skips a crashed window but keeps it for after its reload', () => {
    const t = new IpcTransport();
    const a = new FakeTarget(1);
    t.add(a);
    a.crashed = true;
    t.broadcast(message);
    expect(a.sent).toHaveLength(0);
    a.crashed = false;
    t.broadcast(message);
    expect(a.sent).toHaveLength(1);
  });

  it('keeps delivering to others when one send throws', () => {
    const errors: unknown[] = [];
    const t = new IpcTransport((e) => errors.push(e));
    const bad = new FakeTarget(1);
    const good = new FakeTarget(2);
    bad.throws = true;
    t.add(bad);
    t.add(good);
    t.broadcast(message);
    expect(errors).toHaveLength(1);
    expect(good.sent).toHaveLength(1);
  });
});
