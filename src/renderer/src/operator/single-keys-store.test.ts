import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as SingleKeysStore from './single-keys-store';

/*
 * The single-letter keys setting as the operator window learns it (Session 38). The window shows nothing
 * until it knows (App), so a request that fails must still leave it knowing: the keys on, as they are by
 * default, never a window that stays blank. The main process stood in for by a fake bridge.
 */

type Store = typeof SingleKeysStore;

/** A fresh store (it connects once per page), connected to a bridge that answers with `singleKeys`. */
async function connected(singleKeys: () => Promise<boolean>): Promise<{
  store: Store;
  change: (on: boolean) => void;
}> {
  vi.resetModules();
  let listener: (on: boolean) => void = () => undefined;
  (globalThis as { window?: unknown }).window = {
    drashti: {
      app: {
        singleKeys,
        onSingleKeysChanged: (l: (on: boolean) => void) => {
          listener = l;
          return () => undefined;
        },
      },
    },
  };
  const store = await import('./single-keys-store');
  store.connectSingleKeys();
  return { store, change: (on) => listener(on) };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe('the single-letter keys setting, as the operator window learns it', () => {
  it('is unknown until the main process answers, then as it says', async () => {
    let answer: (on: boolean) => void = () => undefined;
    const { store } = await connected(() => new Promise<boolean>((resolve) => (answer = resolve)));
    expect(store.useSingleKeys.getState().on).toBeNull();
    answer(false);
    await vi.waitFor(() => {
      expect(store.useSingleKeys.getState().on).toBe(false);
    });
  });

  it('takes the keys on (the default) when the request fails, so the window still shows (Session 38)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { store, change } = await connected(() =>
      Promise.reject(new Error("No handler registered for 'app:single-keys'")),
    );
    await vi.waitFor(() => {
      expect(store.useSingleKeys.getState().on).toBe(true);
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not be read'),
      expect.objectContaining({ message: "No handler registered for 'app:single-keys'" }),
    );
    // A change the main process says later still counts.
    change(false);
    expect(store.useSingleKeys.getState().on).toBe(false);
  });

  it('a failed request that comes after a change leaves that change as it is', async () => {
    let fail: (error: Error) => void = () => undefined;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { store, change } = await connected(
      () => new Promise<boolean>((_resolve, reject) => (fail = reject)),
    );
    change(false);
    fail(new Error('A test made this request fail'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.useSingleKeys.getState().on).toBe(false);
  });
});
