import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { leave, motionOff } from './motion';

vi.mock('./motion', () => ({ leave: vi.fn(), motionOff: vi.fn(() => false) }));

const css = () => readFileSync(join(__dirname, 'transient-motion.css'), 'utf8');
const time = (name: string) => {
  const value = new RegExp(`--dur-surface-${name}:\\s*(\\d+)ms;`, 'u').exec(css())?.[1];
  expect(value, `missing surface timing: ${name}`).toBeDefined();
  return Number(value);
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.mocked(motionOff).mockReturnValue(false);
});

describe('operator transient motion budgets', () => {
  it('every Calm entrance, including sheets and the dim, settles within 180 ms', () => {
    for (const name of ['tooltip', 'menu', 'notice', 'dialog', 'scrim', 'sheet']) {
      expect(time(name), name).toBeGreaterThan(0);
      expect(time(name), name).toBeLessThanOrEqual(180);
    }
  });

  it('departures take at most 120 ms and less time than arrivals', () => {
    for (const [entrance, exit] of [
      ['tooltip', 'tooltip-exit'],
      ['menu', 'exit'],
      ['notice', 'exit'],
      ['dialog', 'sheet-exit'],
      ['sheet', 'sheet-exit'],
    ]) {
      expect(time(exit ?? ''), exit).toBeGreaterThan(0);
      expect(time(exit ?? ''), exit).toBeLessThanOrEqual(120);
      expect(time(exit ?? ''), exit).toBeLessThan(time(entrance ?? ''));
    }
  });

  it('animates only opacity and transform, without layout, filter or persistent layer hints', () => {
    const text = css().replace(/\/\*[\s\S]*?\*\//gu, '');
    const frames = [...text.matchAll(/@keyframes\s+[\w-]+\s*\{\s*(?:from|to)\s*\{([^}]+)\}/gu)];
    expect(frames.length).toBeGreaterThanOrEqual(2);
    for (const [, body] of frames) {
      const properties = [...(body ?? '').matchAll(/([\w-]+)\s*:/gu)].map((m) => m[1]);
      expect(properties.filter((p) => p !== 'opacity' && p !== 'transform')).toEqual([]);
    }
    expect(text).not.toMatch(/will-change|translate3d|backdrop-filter|\bfilter\s*:/u);
  });
});

class Surface {
  isConnected = true;
  closest = vi.fn((): Element | null => null);
  querySelector = vi.fn((): Element | null => null);
}

async function page() {
  // Import before installing document: importing shared UI on a phone must not start an operator observer.
  const api = await import('./transient-motion');
  const operator = vi.fn(() => true);
  const opened = vi.fn(() => true);
  const copies = [{ remove: vi.fn() }, { remove: vi.fn() }];
  vi.stubGlobal('HTMLElement', Surface);
  vi.stubGlobal('document', {
    body: { classList: { contains: operator }, lastElementChild: null },
    documentElement: { hasAttribute: opened },
    querySelectorAll: vi.fn(() => copies),
  });
  const surface = new Surface();
  return { ...api, operator, opened, copies, surface, node: surface as unknown as HTMLElement };
}

describe('the existing exit system is used only for safe operator surfaces', () => {
  it('delegates an ordinary operator menu to the existing exit system', async () => {
    const { leaveTransient, node } = await page();
    leaveTransient(node, 'pop');
    expect(leave).toHaveBeenCalledExactlyOnceWith(node, 'pop');
  });

  it('never copies a show control, its ancestor surface or anything inside it', async () => {
    const { leaveTransient, surface, node } = await page();
    surface.closest.mockReturnValue(node);
    leaveTransient(node, 'pop');
    surface.closest.mockReturnValue(null);
    surface.querySelector.mockReturnValue(node);
    leaveTransient(node, 'notice');
    expect(leave).not.toHaveBeenCalled();
  });

  it('leaves no copy on phones or output pages, while opening, or with motion Off/reduced', async () => {
    const { leaveTransient, node, operator, opened } = await page();
    operator.mockReturnValue(false);
    leaveTransient(node, 'notice');
    operator.mockReturnValue(true);
    opened.mockReturnValue(false);
    leaveTransient(node, 'pop');
    opened.mockReturnValue(true);
    vi.mocked(motionOff).mockReturnValue(true);
    leaveTransient(node, 'pop');
    expect(leave).not.toHaveBeenCalled();
  });

  it('does not copy a missing or disconnected surface, or copy the same surface twice', async () => {
    const { leaveTransient, surface, node } = await page();
    leaveTransient(null, 'pop');
    surface.isConnected = false;
    leaveTransient(node, 'pop');
    expect(leave).not.toHaveBeenCalled();
    surface.isConnected = true;
    leaveTransient(node, 'pop');
    leaveTransient(node, 'pop');
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('removes in-flight closed-shadow copies when motion becomes Off or reduced', async () => {
    const { removeTransientCopies, copies } = await page();
    removeTransientCopies();
    for (const copy of copies) expect(copy.remove).not.toHaveBeenCalled();
    vi.mocked(motionOff).mockReturnValue(true);
    removeTransientCopies();
    for (const copy of copies) expect(copy.remove).toHaveBeenCalledTimes(1);
  });
});
