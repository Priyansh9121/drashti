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
