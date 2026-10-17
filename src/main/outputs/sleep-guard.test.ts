import { beforeEach, describe, expect, it } from 'vitest';
import type { PowerSaveApi } from './sleep-guard';
import { SleepGuard } from './sleep-guard';

class FakePower implements PowerSaveApi {
  active = new Set<number>();
  started = 0;
  private next = 1;
  start(type: 'prevent-display-sleep'): number {
    expect(type).toBe('prevent-display-sleep');
    this.started++;
    const id = this.next++;
    this.active.add(id);
    return id;
  }
  stop(id: number): void {
    this.active.delete(id);
  }
  isStarted(id: number): boolean {
    return this.active.has(id);
  }
}

let power: FakePower;
let changes: boolean[];
let guard: SleepGuard;

beforeEach(() => {
  power = new FakePower();
  changes = [];
  guard = new SleepGuard(power, (held) => changes.push(held));
});

describe('SleepGuard', () => {
  it('holds nothing while no output is showing', () => {
    guard.update(0);
    expect(guard.held).toBe(false);
    expect(power.started).toBe(0);
  });

  it('holds one blocker while any output is showing, and releases it when none are', () => {
    guard.update(1);
    expect(guard.held).toBe(true);
    guard.update(3);
    guard.update(2);
    expect(power.started).toBe(1);
    expect(power.active.size).toBe(1);
    guard.update(0);
    expect(guard.held).toBe(false);
    expect(power.active.size).toBe(0);
    expect(changes).toEqual([true, false]);
  });

  it('takes a new blocker for the next show', () => {
    guard.update(1);
    guard.update(0);
    guard.update(1);
    expect(power.started).toBe(2);
    expect(guard.held).toBe(true);
  });

  it('starts again if the OS dropped the blocker', () => {
    guard.update(1);
    power.active.clear();
    expect(guard.held).toBe(false);
    guard.update(1);
    expect(guard.held).toBe(true);
    expect(power.started).toBe(2);
  });

  it('releases on quit, and releasing twice is harmless', () => {
    guard.update(2);
    guard.release();
    guard.release();
    expect(power.active.size).toBe(0);
    expect(changes).toEqual([true, false]);
  });

  it('holds the screens awake while the stream is on air or recording, with no output showing (Session 31)', () => {
    guard.setStreaming(true);
    expect(guard.held).toBe(true);
    // An output showing as well, then turned off: still held, for the stream.
    guard.update(1);
    guard.update(0);
    expect(guard.held).toBe(true);
    expect(power.started).toBe(1);
    // The stream ended: released.
    guard.setStreaming(false);
    expect(guard.held).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('keeps holding for the outputs when the stream ends', () => {
    guard.update(2);
    guard.setStreaming(true);
    guard.setStreaming(false);
    expect(guard.held).toBe(true);
    expect(power.started).toBe(1);
    guard.update(0);
    expect(guard.held).toBe(false);
  });
});
