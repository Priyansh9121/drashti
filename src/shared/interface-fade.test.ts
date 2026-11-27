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
  const api = await import('./interface-fade');
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

describe('soft interface fades keep the show live', () => {
  it('captures only safe pictures, never the root, a show control, a wrapper holding one or an output', async () => {
    const p = await page();
    const change = vi.fn();
    p.fadeInterface(change, 'look');
    expect(change).toHaveBeenCalledTimes(1);
    expect(p.startViewTransition).toHaveBeenCalledTimes(1);
    expect(p.root.style.getPropertyValue('view-transition-name')).toBe('none');
    expect(p.safe.style.getPropertyValue('view-transition-name')).toMatch(/^motionlooks-/u);
    for (const el of [p.show, p.wrapper, p.output])
      expect(el.style.getPropertyValue('view-transition-name')).toBe('');
    expect(p.safe.closest).toHaveBeenCalledWith(expect.stringContaining('[data-show-control]'));
    expect(p.wrapper.querySelector).toHaveBeenCalledWith(expect.stringContaining('[data-show-control]'));
    p.finish();
    await p.finished;
    expect(p.root.style.getPropertyValue('view-transition-name')).toBe('');
    expect(p.safe.style.getPropertyValue('view-transition-name')).toBe('');
  });

  it('fades Help and mode changes in Calm as well, with no snapshot of their containing layout', async () => {
    for (const kind of ['help', 'mode'] as const) {
      const p = await page();
      p.root.dataset['interfaceMotion'] = 'calm';
      p.fadeInterface(() => undefined, kind);
      expect(p.startViewTransition, kind).toHaveBeenCalledTimes(1);
      expect(p.root.dataset['interfaceFade']).toBe(kind);
      expect(p.root.style.getPropertyValue('--motionlooks-in')).toBe(
        kind === 'help' ? 'var(--dur-menu)' : 'var(--dur-crossfade)',
      );
      expect(p.root.style.getPropertyValue('--motionlooks-out')).toBe(
        kind === 'help' ? 'var(--dur-press)' : 'var(--dur-crossfade)',
      );
      p.finish();
      await p.finished;
      expect(p.root.dataset['interfaceFade']).toBeUndefined();
      expect(p.root.style.getPropertyValue('--motionlooks-in')).toBe('');
      expect(p.root.style.getPropertyValue('--motionlooks-out')).toBe('');
    }
  });

  it('is immediate for Off, reduced motion, forced colours, a hidden or opening window, no chip, no API, or a busy show', async () => {
    for (const held of ['off', 'reduced', 'forced', 'hidden', 'opening', 'chip', 'api', 'busy']) {
      const p = await page();
      if (held === 'off') p.root.dataset['interfaceMotion'] = 'off';
      if (held === 'reduced') p.reduced.matches = true;
      if (held === 'forced') p.forced.matches = true;
      if (held === 'hidden') p.doc.visibilityState = 'hidden';
      if (held === 'opening') delete p.root.dataset['opened'];
      if (held === 'chip') p.root.dataset['chip'] = 'unknown';
      if (held === 'api') Object.assign(p.doc, { startViewTransition: undefined });
      const change = vi.fn();
      p.fadeInterface(change, 'look', held !== 'busy');
      expect(change, held).toHaveBeenCalledTimes(1);
      expect(p.startViewTransition, held).not.toHaveBeenCalled();
      expect(p.root.style.getPropertyValue('view-transition-name'), held).toBe('');
    }
  });

  it('finishes a pending change before a newer one and applies each exactly once, even if Chromium calls it later', async () => {
    const p = await page(true);
    const order: string[] = [];
    p.fadeInterface(() => order.push('first'), 'mode');
    const oldUpdate = p.update;
    p.stopInterfaceFade();
    p.fadeInterface(() => order.push('second'), 'mode', false);
    oldUpdate();
    expect(order).toEqual(['first', 'second']);
    expect(p.skipTransition).toHaveBeenCalledTimes(1);
    expect(p.root.dataset['interfaceFade']).toBeUndefined();
    p.finish();
    await p.finished;
  });

  it('stops at once when reduced motion, forced colours, visibility or the chosen motion changes', async () => {
    for (const held of ['reduced', 'forced', 'hidden', 'off']) {
      const p = await page();
      let observed: (() => void) | undefined;
      const disconnect = vi.fn();
      vi.stubGlobal(
        'MutationObserver',
        class {
          constructor(changed: () => void) {
            observed = changed;
          }
          observe() {
            return undefined;
          }
          disconnect = disconnect;
        },
      );
      p.fadeInterface(() => undefined, 'help');
      if (held === 'reduced') {
        p.reduced.matches = true;
        p.reduced.dispatchEvent(new Event('change'));
      }
      if (held === 'forced') {
        p.forced.matches = true;
        p.forced.dispatchEvent(new Event('change'));
      }
      if (held === 'hidden') {
        p.doc.visibilityState = 'hidden';
        p.doc.dispatchEvent(new Event('visibilitychange'));
      }
      if (held === 'off') {
        p.root.dataset['interfaceMotion'] = 'off';
        observed?.();
      }
      expect(p.skipTransition, held).toHaveBeenCalledTimes(1);
      expect(p.root.dataset['interfaceFade'], held).toBeUndefined();
      p.finish();
      await p.finished;
    }
  });

  it('falls back to the change exactly once if snapshots cannot start', async () => {
    const p = await page();
    p.startViewTransition.mockImplementation(() => {
      throw new Error('No snapshot');
    });
    const change = vi.fn();
    p.fadeInterface(change, 'mode');
    expect(change).toHaveBeenCalledTimes(1);
    expect(p.root.dataset['interfaceFade']).toBeUndefined();
  });
});
