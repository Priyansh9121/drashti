import { afterEach, describe, expect, it, vi } from 'vitest';

function style() {
  const values = new Map<string, string>();
  return {
    getPropertyValue: (name: string) => values.get(name) ?? '',
    getPropertyPriority: () => '',
    setProperty: (name: string, value: string) => values.set(name, value),
    removeProperty: (name: string) => values.delete(name),
  };
}

function element(blocked = false, holdsShow = false) {
  return {
    style: style(),
    closest: vi.fn(() => (blocked ? {} : null)),
    querySelector: vi.fn(() => (holdsShow ? {} : null)),
    contains: (other: unknown) => other === null,
    getBoundingClientRect: () => ({ width: 24, height: 24 }),
  };
}

async function page(deferred = false) {
  vi.resetModules();
  const root = {
    style: style(),
    dataset: { opened: '', chip: 'yes', interfaceMotion: 'lively' } as Record<string, string>,
  };
  const safe = element();
  const show = element(true);
  const wrapper = element(false, true);
  const output = element(true);
  let update: (() => void) | undefined;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const skipTransition = vi.fn();
  const startViewTransition = vi.fn((change: () => void) => {
    update = change;
    if (!deferred) change();
    return { finished, skipTransition };
  });
  const doc = Object.assign(new EventTarget(), {
    documentElement: root,
    visibilityState: 'visible',
    querySelectorAll: vi.fn(() => [safe, show, wrapper, output]),
    startViewTransition,
  });
  const reduced = Object.assign(new EventTarget(), { matches: false });
  const forced = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('matchMedia', (query: string) => (query.includes('reduced') ? reduced : forced));
  const api = await import('../../../shared/interface-fade');
  return {
    ...api,
    root,
    safe,
    show,
    wrapper,
    output,
    doc,
    reduced,
    forced,
    startViewTransition,
    skipTransition,
    finish,
    finished,
    update: () => update?.(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the controls using a deferred browser snapshot', () => {
  it('keeps one mode fade when the IPC event and reply repeat the same choice', async () => {
    const p = await page(true);
    let changed: (mode: 'pro' | 'simple') => void = () => undefined;
    vi.stubGlobal('window', {
      drashti: {
        app: {
          onModeChanged: (listener: typeof changed) => {
            changed = listener;
          },
          getMode: () => new Promise(() => undefined),
          setMode: () => {
            changed('simple');
            return Promise.resolve({ ok: true, mode: 'simple' });
          },
        },
      },
    });
    const store = await import('../operator/mode-store');
    store.useMode.setState({ mode: 'pro' });
    store.connectMode();
    await store.enterSimpleMode();
    expect(p.startViewTransition).toHaveBeenCalledTimes(1);
    expect(p.skipTransition).not.toHaveBeenCalled();
    p.update();
    expect(store.useMode.getState().mode).toBe('simple');
    p.finish();
    await p.finished;
  });

  it('two rapid Help toggles end off, with no stale callback restoring a question or its key hints', async () => {
    const p = await page(true);
    const storage = { getItem: () => null, setItem: () => undefined };
    vi.stubGlobal('window', { localStorage: storage, sessionStorage: storage });
    const help = await import('../help/help-store');
    help.toggleHelp();
    help.toggleHelp();
    p.stopInterfaceFade();
    p.update();
    expect(help.useHelp.getState()).toMatchObject({ on: false, round: 1 });
    expect(p.root.dataset['interfaceFade']).toBeUndefined();
    p.finish();
    await p.finished;
  });
});
