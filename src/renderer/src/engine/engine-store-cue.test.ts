import { afterEach, expect, it, vi } from 'vitest';
import { ENGINE_STATE_VERSION, initialEngineState } from '../../../shared/engine/state';
import type { EngineMessage } from '../../../shared/engine/protocol';

afterEach(() => { vi.useRealTimers(); });

it('holds only the operator’s Go cleanup redraw, without losing revisions or a later Clear', async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const { connectEngineSource, useEngine } = await import('./engine-store');
  let send: (message: EngineMessage) => void = () => undefined;
  const state = initialEngineState();
  state.videoStart = { id: 'placeholder-cue', at: Date.now(), before: state.layers };
  connectEngineSource({ onMessage: (listener) => { send = listener; }, resync: vi.fn() }, { deferCueCleanup: true });
  send({ kind: 'snapshot', version: ENGINE_STATE_VERSION, rev: 1, state, sentAt: Date.now() });
  const before = useEngine.getState().state;
  const redraw = vi.fn();
  const unsubscribe = useEngine.subscribe((next, previous) => {
    if (next.state !== previous.state) redraw();
  });
  send({ kind: 'patch', version: ENGINE_STATE_VERSION, baseRev: 1, rev: 2,
    ops: [{ path: ['videoStart'], value: null }], sentAt: Date.now() });
  expect(useEngine.getState().rev).toBe(2);
  expect(useEngine.getState().state).toBe(before);
  expect(redraw).not.toHaveBeenCalled();
  send({ kind: 'patch', version: ENGINE_STATE_VERSION, baseRev: 2, rev: 3,
    ops: [{ path: ['blackout'], value: true }], sentAt: Date.now() });
  expect(useEngine.getState().state?.videoStart).toBeNull();
  expect(useEngine.getState().state?.blackout).toBe(true);
  expect(redraw).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(250);
  expect(redraw).toHaveBeenCalledTimes(1);
  unsubscribe();
});

it('publishes the held cleanup once at Go + 250 ms even without another message', async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const { connectEngineSource, useEngine } = await import('./engine-store');
  let send: (message: EngineMessage) => void = () => undefined;
  const state = initialEngineState();
  state.videoStart = { id: 'placeholder-cue', at: Date.now(), before: state.layers };
  connectEngineSource({ onMessage: (listener) => { send = listener; }, resync: vi.fn() }, { deferCueCleanup: true });
  send({ kind: 'snapshot', version: ENGINE_STATE_VERSION, rev: 1, state, sentAt: Date.now() });
  send({ kind: 'patch', version: ENGINE_STATE_VERSION, baseRev: 1, rev: 2,
    ops: [{ path: ['videoStart'], value: null }], sentAt: Date.now() });
  vi.advanceTimersByTime(249);
  expect(useEngine.getState().state?.videoStart?.id).toBe('placeholder-cue');
  vi.advanceTimersByTime(1);
  expect(useEngine.getState().state?.videoStart).toBeNull();
});
