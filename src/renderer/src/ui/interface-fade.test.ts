import { afterEach, describe, expect, it, vi } from 'vitest';

async function page() {
  vi.resetModules();
  const startViewTransition = vi.fn(() => ({
    finished: new Promise<void>(() => undefined),
    skipTransition: vi.fn(),
  }));
  vi.stubGlobal('document', {
    documentElement: {
      dataset: { opened: '', chip: 'yes', interfaceMotion: 'calm' },
      style: { getPropertyValue: () => '', getPropertyPriority: () => '', setProperty: vi.fn() },
    },
    visibilityState: 'visible',
    querySelectorAll: () => [],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    startViewTransition,
  });
  return { startViewTransition };
}

afterEach(() => vi.unstubAllGlobals());

describe('mode and Help changes leave no deferred UI update', () => {
  it('draws the IPC mode event immediately, deduplicating the same reply without capturing the document', async () => {
    const p = await page();
    let changed: (mode: 'pro' | 'simple') => void = () => undefined;
    let store: typeof import('../operator/mode-store');
    vi.stubGlobal('window', {
      drashti: {
        app: {
          onModeChanged: (listener: typeof changed) => {
            changed = listener;
          },
          getMode: () => new Promise(() => undefined),
          setMode: () => {
            changed('simple');
            expect(store.useMode.getState().mode).toBe('simple');
            return Promise.resolve({ ok: true, mode: 'simple' });
          },
        },
      },
    });
    store = await import('../operator/mode-store');
    store.useMode.setState({ mode: 'pro' });
    const notified = vi.fn();
    store.useMode.subscribe(notified);
    store.connectMode();
    await store.enterSimpleMode();
    expect(store.useMode.getState().mode).toBe('simple');
    expect(notified).toHaveBeenCalledTimes(1);
    expect(p.startViewTransition).not.toHaveBeenCalled();
  });

  it('two rapid Help toggles end off immediately, with no stale callback or captured key hint', async () => {
    const p = await page();
    const storage = { getItem: () => null, setItem: () => undefined };
    vi.stubGlobal('window', { localStorage: storage, sessionStorage: storage });
    const help = await import('../help/help-store');
    help.toggleHelp();
    expect(help.useHelp.getState()).toMatchObject({ on: true, round: 1 });
    help.toggleHelp();
    expect(help.useHelp.getState()).toMatchObject({ on: false, round: 1 });
    expect(p.startViewTransition).not.toHaveBeenCalled();
  });
});
