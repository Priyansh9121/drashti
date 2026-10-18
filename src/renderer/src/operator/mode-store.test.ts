import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ModeStore from './mode-store';
import type { OperatorMode } from '../../../shared/mode';

/*
 * The mode as the operator window learns it (Session 38). The window shows nothing until it knows (App), so a
 * request that fails must still leave it knowing: Simple Mode, the safe side (only the show's controls, each
 * of which works in either mode), until the main process says otherwise. The main process stood in for by a
 * fake bridge.
 */

type Store = typeof ModeStore;

/** A fresh store (it connects once per page), connected to a bridge that answers with `getMode`. */
async function connected(getMode: () => Promise<OperatorMode>): Promise<{
  store: Store;
  change: (mode: OperatorMode) => void;
}> {
  vi.resetModules();
  let listener: (mode: OperatorMode) => void = () => undefined;
  (globalThis as { window?: unknown }).window = {
    drashti: {
      app: {
        getMode,
        onModeChanged: (l: (mode: OperatorMode) => void) => {
          listener = l;
          return () => undefined;
        },
        onAskLeaveSimple: () => () => undefined,
      },
    },
  };
  const store = await import('./mode-store');
  store.connectMode();
  return { store, change: (mode) => listener(mode) };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe('the mode, as the operator window learns it', () => {
  it('is unknown until the main process answers, then as it says', async () => {
    let answer: (mode: OperatorMode) => void = () => undefined;
    const { store } = await connected(() => new Promise<OperatorMode>((resolve) => (answer = resolve)));
    expect(store.useMode.getState().mode).toBeNull();
    answer('pro');
    await vi.waitFor(() => {
      expect(store.useMode.getState().mode).toBe('pro');
    });
  });

  it('takes Simple Mode when the request fails, so the window still shows (Session 38)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { store, change } = await connected(() =>
      Promise.reject(new Error("No handler registered for 'app:get-mode'")),
    );
    await vi.waitFor(() => {
      expect(store.useMode.getState().mode).toBe('simple');
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not be asked'),
      expect.objectContaining({ message: "No handler registered for 'app:get-mode'" }),
    );
    // The main process's next word on it counts.
    change('pro');
    expect(store.useMode.getState().mode).toBe('pro');
  });

  it('a failed request that comes after the main process said the mode leaves it as it said', async () => {
    let fail: (error: Error) => void = () => undefined;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { store, change } = await connected(
      () => new Promise<OperatorMode>((_resolve, reject) => (fail = reject)),
    );
    change('pro');
    fail(new Error('A test made this request fail'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.useMode.getState().mode).toBe('pro');
  });
});
