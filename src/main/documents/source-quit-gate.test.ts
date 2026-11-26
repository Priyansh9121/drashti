import { afterEach, describe, expect, it, vi } from 'vitest';
import { SourceQuitGate } from './source-quit-gate';

afterEach(() => vi.useRealTimers());

describe('source-only confirmed quit gate', () => {
  it('admits no new source work and resumes quit once after the same bounded drain', async () => {
    let release: (confirmed: boolean) => void = () => undefined;
    const cancel = vi.fn();
    const stop = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const gate = new SourceQuitGate({ cancel, stop });
    const event = { preventDefault: vi.fn() };
    const resume = vi.fn(),
      refused = vi.fn();
    expect(gate.request(event, resume, refused)).toBe(false);
    expect(gate.request(event, resume, refused)).toBe(false);
    expect(gate.closing).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
    release(true);
    expect(await gate.drain()).toEqual({ confirmed: true });
    await Promise.resolve();
    expect(resume).toHaveBeenCalledTimes(1);
    expect(refused).not.toHaveBeenCalled();
    expect(gate.request(event, resume, refused)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
  });

  it('does not call a quarantined or failed stop a confirmed drain', async () => {
    for (const stop of [
      () => Promise.resolve(false),
      () => Promise.reject(new Error('Placeholder stop failure')),
    ]) {
      const gate = new SourceQuitGate({ cancel: () => undefined, stop });
      const resume = vi.fn(),
        refused = vi.fn();
      expect(gate.request({ preventDefault: () => undefined }, resume, refused)).toBe(false);
      expect((await gate.drain()).confirmed).toBe(false);
      await Promise.resolve();
      expect(gate.confirmed).toBe(false);
      expect(resume).not.toHaveBeenCalled();
      expect(refused).toHaveBeenCalledTimes(1);
    }
  });

  it('returns a bounded unconfirmed outcome and ignores a late successful stop', async () => {
    vi.useFakeTimers();
    let release: (confirmed: boolean) => void = () => undefined;
    const gate = new SourceQuitGate({
      cancel: () => undefined,
      stop: () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
      timeoutMs: 20,
    });
    const pending = gate.drain();
    await vi.advanceTimersByTimeAsync(21);
    expect(await pending).toEqual({ confirmed: false, reason: 'timeout' });
    release(true);
    await Promise.resolve();
    expect(gate.confirmed).toBe(false);
    expect(await gate.drain()).toEqual({ confirmed: false, reason: 'timeout' });
  });
});

describe('a later quit after a refused one (O1)', () => {
  it('asks the gate again: a fresh bounded drain, and the quit goes ahead once that one is confirmed', async () => {
    let confirm = false;
    const cancel = vi.fn();
    const stop = vi.fn(() => Promise.resolve(confirm));
    const gate = new SourceQuitGate({ cancel, stop });
    const event = { preventDefault: vi.fn() };
    const resume = vi.fn(),
      refused = vi.fn();
    expect(gate.request(event, resume, refused)).toBe(false);
    expect(await gate.drain()).toEqual({ confirmed: false, reason: 'quarantined' });
    await Promise.resolve();
    expect(refused).toHaveBeenCalledTimes(1);
    // Refused, it still admits no new source work ("Restart Drashti before…").
    expect(gate.closing).toBe(true);
    confirm = true;
    expect(gate.request(event, resume, refused)).toBe(false);
    expect(await gate.drain()).toEqual({ confirmed: true });
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(refused).toHaveBeenCalledTimes(1);
    expect(gate.request(event, resume, refused)).toBe(true);
  });

  it('an exit (a self-test’s end, a node restarting as Main) after a refused quit asks again too, and a confirmed drain is kept', async () => {
    let confirm = false;
    const stop = vi.fn(() => Promise.resolve(confirm));
    const gate = new SourceQuitGate({ cancel: () => undefined, stop });
    expect(await gate.drainForQuit()).toEqual({ confirmed: false, reason: 'quarantined' });
    confirm = true;
    expect(await gate.drainForQuit()).toEqual({ confirmed: true });
    expect(await gate.drainForQuit()).toEqual({ confirmed: true });
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('a reader given up on before the quit asked never holds it; one given up on in its drain holds that quit only', async () => {
    // Given up on while editing ("Restart Drashti before editing more imported slides"): the quit goes ahead.
    const before = new SourceQuitGate({
      cancel: () => undefined,
      stop: () => Promise.resolve(true),
      givenUp: () => 1,
    });
    expect(await before.drainForQuit()).toEqual({ confirmed: true });
    // Given up on as this quit drains: this quit is refused, the next goes ahead.
    let givenUp = 0;
    let giveUpNow = true;
    const during = new SourceQuitGate({
      cancel: () => undefined,
      stop: () => {
        if (giveUpNow) givenUp += 1;
        giveUpNow = false;
        return Promise.resolve(true);
      },
      givenUp: () => givenUp,
    });
    expect(await during.drainForQuit()).toEqual({ confirmed: false, reason: 'quarantined' });
    expect(await during.drainForQuit()).toEqual({ confirmed: true });
  });
});
