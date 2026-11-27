import { afterEach, describe, expect, it, vi } from 'vitest';

function style() {
  const values = new Map<string, string>();
  return {
    getPropertyValue: (name: string) => values.get(name) ?? '',
    getPropertyPriority: () => '',
    setProperty: (name: string, value: string) => { values.set(name, value); },
    removeProperty: (name: string) => { values.delete(name); },
  };
}

function question(text = '?', blocked = false, holdsShow = false) {
  const cancel = vi.fn();
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return {
    textContent: text,
    style: style(),
    contains: () => false,
    closest: vi.fn(() => (blocked ? {} : null)),
    querySelector: vi.fn(() => (holdsShow ? {} : null)),
    getBoundingClientRect: () => ({ width: 24, height: 24 }),
    animate: vi.fn(() => ({ cancel, finished })),
    cancel,
    finish,
    finished,
  };
}

async function page() {
  vi.resetModules();
  const root = { style: style(), dataset: { opened: '', chip: 'yes', interfaceMotion: 'calm' } as Record<string, string> };
  const safe = question();
  const word = question('Screens');
  const show = question('?', true);
  const wrapper = question('?', false, true);
  const startViewTransition = vi.fn(() => {
    throw new Error('Document capture is forbidden');
  });
  const doc = Object.assign(new EventTarget(), {
    documentElement: root,
    visibilityState: 'visible',
    querySelectorAll: vi.fn(() => [safe, word, show, wrapper]),
    startViewTransition,
  });
  const reduced = Object.assign(new EventTarget(), { matches: false });
  const forced = Object.assign(new EventTarget(), { matches: false });
  let changed: (() => void) | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('matchMedia', (q: string) => (q.includes('reduced') ? reduced : forced));
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) =>
      name === '--dur-menu' ? '160ms' : name === '--ease-out' ? 'cubic-bezier(0.23, 1, 0.32, 1)' : '',
  }));
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(callback: () => void) {
        changed = callback;
      }
      observe() {
        return undefined;
      }
      disconnect = disconnect;
    },
  );
  return {
    ...(await import('./interface-fade')),
    root,
    doc,
    safe,
    word,
    show,
    wrapper,
    reduced,
    forced,
    startViewTransition,
    changed: () => changed?.(),
    disconnect,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('Help fades only its live question marks, with no document capture', () => {
  it('applies the change synchronously, then animates only a question’s own opacity using the motion tokens', async () => {
    for (const motion of ['calm', 'lively']) {
      const p = await page();
      p.root.dataset['interfaceMotion'] = motion;
      const change = vi.fn(() => expect(p.safe.animate).not.toHaveBeenCalled());
      p.fadeInterface(change, 'help');
      expect(change).toHaveBeenCalledTimes(1);
      expect(p.startViewTransition).not.toHaveBeenCalled();
      expect(p.doc.querySelectorAll).toHaveBeenCalledWith('[data-what-is-this]');
      expect(p.safe.animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], {
        duration: 160,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
        fill: 'none',
      });
      for (const el of [p.word, p.show, p.wrapper]) expect(el.animate).not.toHaveBeenCalled();
      expect(p.root.dataset['interfaceFade']).toBeUndefined();
      p.safe.finish();
      await p.safe.finished;
      await Promise.resolve();
      expect(p.disconnect).toHaveBeenCalledTimes(1);
    }
  });

  it('changes immediately and starts nothing for every motion constraint or a busy show', async () => {
    for (const held of ['off', 'reduced', 'forced', 'hidden', 'opening', 'no-chip', 'unknown-chip', 'busy']) {
      const p = await page();
      if (held === 'off') p.root.dataset['interfaceMotion'] = 'off';
      if (held === 'reduced') p.reduced.matches = true;
      if (held === 'forced') p.forced.matches = true;
      if (held === 'hidden') p.doc.visibilityState = 'hidden';
      if (held === 'opening') delete p.root.dataset['opened'];
      if (held === 'no-chip') p.root.dataset['chip'] = 'no';
      if (held === 'unknown-chip') p.root.dataset['chip'] = 'unknown';
      const change = vi.fn();
      p.fadeInterface(change, 'help', held !== 'busy');
      expect(change, held).toHaveBeenCalledTimes(1);
      expect(p.safe.animate, held).not.toHaveBeenCalled();
      expect(p.startViewTransition, held).not.toHaveBeenCalled();
    }
  });

  it('stops the live animation on a show change; no update is left pending or applied twice', async () => {
    const p = await page();
    const change = vi.fn();
    p.fadeInterface(change, 'help');
    p.stopInterfaceFade();
    expect(p.safe.cancel).toHaveBeenCalledTimes(1);
    p.safe.finish();
    await p.safe.finished;
    expect(change).toHaveBeenCalledTimes(1);
    expect(p.disconnect).toHaveBeenCalledTimes(1);
  });

  it('cancels at once for reduced motion, forced colours, hidden/opening windows, Off or loss of a known chip', async () => {
    for (const held of ['reduced', 'forced', 'hidden', 'opening', 'off', 'chip']) {
      const p = await page();
      p.fadeInterface(() => undefined, 'help');
      if (held === 'reduced' || held === 'forced') {
        p[held].matches = true;
        p[held].dispatchEvent(new Event('change'));
      } else if (held === 'hidden') {
        p.doc.visibilityState = 'hidden';
        p.doc.dispatchEvent(new Event('visibilitychange'));
      } else {
        if (held === 'opening') delete p.root.dataset['opened'];
        if (held === 'off') p.root.dataset['interfaceMotion'] = 'off';
        if (held === 'chip') p.root.dataset['chip'] = 'unknown';
        p.changed();
      }
      expect(p.safe.cancel, held).toHaveBeenCalledTimes(1);
      expect(p.disconnect, held).toHaveBeenCalledTimes(1);
    }
  });

  it('keeps the change synchronous and once-only when a live animation cannot start', async () => {
    const p = await page();
    p.safe.animate.mockImplementation(() => {
      throw new Error('No animation');
    });
    const change = vi.fn();
    p.fadeInterface(change, 'help');
    expect(change).toHaveBeenCalledTimes(1);
    expect(p.startViewTransition).not.toHaveBeenCalled();
  });
});
