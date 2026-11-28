import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { leave, motionOff } from './motion';
import { Notice } from './Notice';

vi.mock('./motion', () => ({
  leave: vi.fn(),
  motionOff: vi.fn(() => false),
  useArrival: vi.fn((kind: string | null) => kind ?? undefined),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.mocked(leave).mockReset();
  vi.mocked(motionOff).mockReturnValue(false);
});

class Surface {
  isConnected = true;
  dataset: Record<string, string> = {};
  style = {
    opacity: '',
    getPropertyPriority: () => '',
    setProperty: (name: string, value: string) => {
      if (name === 'opacity') this.style.opacity = value;
    },
    removeProperty: () => {
      this.style.opacity = '';
      return '';
    },
  };
  closest = vi.fn<(selector: string) => Element | null>(() => null);
  querySelector = vi.fn<(selector: string) => Element | null>(() => null);
}

async function page() {
  // Import before installing document: importing shared UI on a phone must not start an operator observer.
  const api = await import('./transient-motion');
  const operator = vi.fn(() => true);
  const output = vi.fn(() => !operator());
  const opened = vi.fn(() => true);
  const copies = [{ remove: vi.fn() }, { remove: vi.fn() }];
  vi.stubGlobal('HTMLElement', Surface);
  vi.stubGlobal('getComputedStyle', () => ({ opacity: '1' }));
  vi.stubGlobal('document', {
    body: { classList: { contains: operator }, matches: output, lastElementChild: null },
    documentElement: { hasAttribute: opened },
    querySelectorAll: vi.fn(() => copies),
  });
  const surface = new Surface();
  return { ...api, operator, output, opened, copies, surface, node: surface as unknown as HTMLElement };
}

describe('the existing exit system is used only for safe operator surfaces', () => {
  it('phone and output notices never opt into an operator entrance', async () => {
    const { operator } = await page();
    operator.mockReturnValue(false);
    const phone = renderToStaticMarkup(createElement(Notice, { title: 'Placeholder phone notice' }));
    expect(phone).not.toContain('data-motion=');
    operator.mockReturnValue(true);
    const operatorNotice = renderToStaticMarkup(
      createElement(Notice, { title: 'Placeholder operator notice' }),
    );
    expect(operatorNotice).toContain('data-motion="notice"');
  });

  it('keeps the existing notice arrival in secondary desktop windows', async () => {
    const { operator, output } = await page();
    operator.mockReturnValue(false);
    output.mockReturnValue(false);
    const html = renderToStaticMarkup(createElement(Notice, { title: 'Placeholder desktop notice' }));
    expect(html).toContain('data-motion="notice"');
  });

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

  it('does not flash opaque when a surface closes partway through its entrance', async () => {
    const { leaveTransient, node } = await page();
    node.style.opacity = '0.8';
    vi.stubGlobal('getComputedStyle', () => ({ opacity: '0.4' }));
    let copiedOpacity = '';
    vi.mocked(leave).mockImplementation(() => {
      copiedOpacity = node.style.opacity;
    });
    leaveTransient(node, 'pop');
    expect(copiedOpacity).toBe('0.4');
    expect(node.style.opacity).toBe('0.8');
  });

  it('keeps a chat exit private in report pictures, bounded to the card and its travel', async () => {
    const { leaveTransient, surface, node } = await page();
    surface.closest.mockImplementation((selector: string) =>
      selector.includes('data-report-private') ? node : null,
    );
    const host = Object.assign(new Surface(), {
      hasAttribute: vi.fn(() => true),
      setAttribute: vi.fn(),
      style: {},
    });
    Object.assign(node, {
      getBoundingClientRect: () => ({ left: 300, top: 400, width: 320, height: 80 }),
    });
    vi.mocked(leave).mockImplementation(() => {
      Object.assign(document.body, { lastElementChild: host });
    });
    leaveTransient(node, 'notice');
    expect(host.setAttribute).toHaveBeenCalledWith('data-report-private', '');
    expect(host.style).toMatchObject({ left: '284px', top: '384px', width: '352px', height: '112px' });
  });
});


describe('transient entrance eligibility is retained for each actual surface', () => {
  it('marks a fresh operator surface only after opening has settled', async () => {
    const { arriveTransient, node } = await page();
    arriveTransient(node, 'pop');
    expect(node.dataset['motion']).toBe('pop');
  });

  it('never replays a tooltip or chat shown during an opening hold when that hold releases', async () => {
    const { arriveTransient, opened } = await page();
    for (const kind of ['pop', 'notice'] as const) {
      const node = new Surface() as unknown as HTMLElement;
      opened.mockReturnValue(false);
      arriveTransient(node, kind);
      expect(node.dataset['motion']).toBeUndefined();
      opened.mockReturnValue(true);
      arriveTransient(node, kind);
      expect(node.dataset['motion']).toBeUndefined();
      const fresh = new Surface() as unknown as HTMLElement;
      arriveTransient(fresh, kind);
      expect(fresh.dataset['motion']).toBe(kind);
    }
  });

  it('also retains the decision for Off/reduced motion, a still chat, and secondary windows', async () => {
    const { arriveTransient, operator } = await page();
    const off = new Surface() as unknown as HTMLElement;
    vi.mocked(motionOff).mockReturnValue(true);
    arriveTransient(off, 'pop');
    vi.mocked(motionOff).mockReturnValue(false);
    arriveTransient(off, 'pop');
    expect(off.dataset['motion']).toBeUndefined();
    const still = new Surface() as unknown as HTMLElement;
    arriveTransient(still, 'notice', false);
    arriveTransient(still, 'notice');
    expect(still.dataset['motion']).toBeUndefined();
    const secondary = new Surface() as unknown as HTMLElement;
    operator.mockReturnValue(false);
    arriveTransient(secondary, 'notice');
    operator.mockReturnValue(true);
    arriveTransient(secondary, 'notice');
    expect(secondary.dataset['motion']).toBeUndefined();
  });
});
