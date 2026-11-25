import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SabhaFlow } from '../../../shared/sabha-flow';
import { FlowSectionView } from '../web/remote/FlowSheet';
import { FlowNowNext, type FlowNowNextProps } from './FlowNowNext';
import { FlowReadList } from './FlowViews';

/*
 * Now and Next up (alpha.23, QA23-FLOW-2; the owner: "if we are on 1, it should say next up this program, video which
 * is also seen on phone paired"), drawn as the operator window's Sabha flow panel and a paired phone draw it: ONE Now
 * and Next up for both, so they say the same. The panel's has Back and Next; the phone's is read only and larger.
 * Placeholder words only, never a real running order.
 */

const flow = (over: Partial<SabhaFlow> = {}): SabhaFlow => ({
  id: 'flow-0001-test',
  fileName: 'placeholder-flow.pdf',
  pageCount: 1,
  drawnPages: 1,
  status: 'read',
  lang: 'en',
  title: 'Placeholder evening',
  headers: ['No.', 'Program', 'Details', 'Duration', 'Presenter'],
  items: [
    { no: '1', cells: ['Opening', 'Placeholder words one', '10 min', 'Speaker A'] },
    { no: '2', cells: ['Video', 'Placeholder clip', '15 min', 'Speaker B'] },
    { no: '3', cells: ['Talk', 'Placeholder words three', '15 min', 'Speaker B'] },
  ],
  total: 'Total 40 min',
  ...over,
});

const nothing = () => undefined;

const draw = (props: Partial<FlowNowNextProps> & { now: number | null }) =>
  renderToStaticMarkup(
    createElement(FlowNowNext, { flow: flow(), size: 'panel', onBack: nothing, onNext: nothing, ...props }),
  );

/** The text a person reads (tags out, the separators' hidden commas out). */
const words = (html: string) =>
  html
    .replace(/<span class="sr-only">[^<]*<\/span>/gu, '')
    .replace(/<[^>]+>/gu, '')
    .replace(/&#x27;/gu, '’')
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim();

/** The words of the element with this test id (a <p>). */
const line = (html: string, testId: string) =>
  words(new RegExp(`data-testid="${testId}"[^>]*>(.*?)</p>`, 'u').exec(html)?.[1] ?? '');

/** The opening tag of the element with this test id. */
const tag = (html: string, testId: string) =>
  new RegExp(`<[a-z]+ [^>]*data-testid="${testId}"[^>]*>`, 'u').exec(html)?.[0] ?? '';

/** The opening tag of the button with this test id. */
const button = (html: string, testId: string) =>
  new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`, 'u').exec(html)?.[0] ?? '';

describe('Now and Next up in the operator window’s Sabha flow panel (QA23-FLOW-2)', () => {
  it('on 1 shows "Now: 1 · Program · Details" and, larger, "Next up: 2 · Program · Details · Duration · Presenter"', () => {
    const html = draw({ now: 0 });
    expect(line(html, 'flow-now')).toBe('Now: 1 · Opening · Placeholder words one');
    expect(line(html, 'flow-next')).toBe('Next up: 2 · Video · Placeholder clip · 15 min · Speaker B');
    // Next up stands out: larger and bolder than Now.
    expect(tag(html, 'flow-next')).toMatch(/class="[^"]*text-base[^"]*font-bold/u);
    expect(tag(html, 'flow-now')).toMatch(/class="[^"]*text-xs/u);
  });

  it('has Back and Next first, above Now and Next up, so a long Next up never pushes them out of reach', () => {
    const html = draw({ now: 0 });
    expect(html.indexOf('data-testid="flow-back-button"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-testid="flow-back-button"')).toBeLessThan(
      html.indexOf('data-testid="flow-now"'),
    );
    expect(html.indexOf('data-testid="flow-next-button"')).toBeLessThan(
      html.indexOf('data-testid="flow-now"'),
    );
  });

  it('shows a Video row as the video', () => {
    expect(tag(draw({ now: 0 }), 'flow-next')).toContain('data-video="true"');
    expect(draw({ now: 1 })).not.toContain('data-video="true"');
  });

  it('keeps the PDF’s own language on Next up’s words, inside Drashti’s English label', () => {
    const html = draw({
      flow: flow({ lang: 'gu', items: [{ no: '૧', cells: ['કાર્યક્રમ', 'વિગત', '૫ મિનિટ', 'વક્તા'] }] }),
      now: null,
    });
    expect(line(html, 'flow-next')).toBe('Next up: ૧ · કાર્યક્રમ · વિગત · ૫ મિનિટ · વક્તા');
    expect(html).toContain('<span lang="gu">કાર્યક્રમ</span>');
    expect(html).not.toMatch(/data-testid="flow-now-next"[^>]*lang=/u);
  });

  it('on the last item says "Last item", and Next cannot move on yet keeps its Tab stop (the keyboard keeps its place)', () => {
    const html = draw({ now: 2 });
    expect(line(html, 'flow-next')).toBe('Last item');
    const next = button(html, 'flow-next-button');
    expect(next).toContain('aria-disabled="true"');
    expect(next).not.toContain('disabled=""');
    // Back can move.
    expect(button(html, 'flow-back-button')).not.toMatch(/aria-disabled="true"|disabled=""/u);
  });

  it('before anything is Now: "Now: not started", Next up is the first item, and Back cannot move yet keeps its Tab stop', () => {
    const html = draw({ now: null });
    expect(line(html, 'flow-now')).toBe('Now: not started');
    expect(line(html, 'flow-next')).toBe('Next up: 1 · Opening · Placeholder words one · 10 min · Speaker A');
    const back = button(html, 'flow-back-button');
    expect(back).toContain('aria-disabled="true"');
    expect(back).not.toContain('disabled=""');
    expect(button(html, 'flow-next-button')).not.toMatch(/aria-disabled="true"|disabled=""/u);
  });

  it('says a change to a screen reader once, Now and Next up together (not the buttons), its buttons named as the Sabha flow’s own, with the words they show', () => {
    const html = draw({ now: 0 });
    expect(html.match(/aria-live=/gu)).toHaveLength(1);
    const live = /<div[^>]*aria-live="polite"[^>]*>(.*?)<\/div>/u.exec(html);
    expect(live?.[0]).toContain('aria-atomic="true"');
    expect(live?.[1]).toContain('data-testid="flow-now"');
    expect(live?.[1]).toContain('data-testid="flow-next"');
    expect(live?.[1]).not.toContain('<button');
    // Names of their own, never the show's Next or Next item, each holding the word it shows.
    expect(button(html, 'flow-back-button')).toContain('aria-label="Sabha flow: Back"');
    expect(button(html, 'flow-next-button')).toContain('aria-label="Sabha flow: Next"');
    expect(
      words(/<button[^>]*data-testid="flow-back-button"[^>]*>(.*?)<\/button>/u.exec(html)?.[1] ?? ''),
    ).toBe('Back');
    expect(
      words(/<button[^>]*data-testid="flow-next-button"[^>]*>(.*?)<\/button>/u.exec(html)?.[1] ?? ''),
    ).toBe('Next');
    // The middle dots are hidden from a screen reader, which reads a comma between the parts instead.
    expect(html).toContain('<span aria-hidden="true"> · </span>');
    expect(html).toContain('<span class="sr-only">, </span>');
  });
});

/** The element with this test id in what FlowNowNext returns (it has no hooks, so it can be called as it is). */
function find(node: ReactNode, testId: string): { onClick?: () => void } | null {
  if (Array.isArray(node)) {
    for (const child of node as ReactNode[]) {
      const found = find(child, testId);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { 'data-testid'?: string; children?: ReactNode; onClick?: () => void };
  if (props['data-testid'] === testId) return props;
  return find(props.children, testId);
}

describe('the read list’s rows, for a screen reader', () => {
  it('are named by their number and parts with a comma between, as said: no middle dot, no space before a comma', () => {
    const html = renderToStaticMarkup(createElement(FlowReadList, { flow: flow(), now: 1, onPick: nothing }));
    const names = [...html.matchAll(/<button[^>]*data-testid="flow-row"[^>]*>/gu)].map(
      (m) => /aria-label="([^"]*)"/u.exec(m[0])?.[1] ?? '',
    );
    expect(names).toEqual([
      '1, Opening, Placeholder words one, 10 min, Speaker A',
      '2, Video, Placeholder clip, 15 min, Speaker B',
      '3, Talk, Placeholder words three, 15 min, Speaker B',
    ]);
  });
});

describe('Back and Next pressed while an ask is on its way (a22-review-flow M3)', () => {
  it('reach the store even while they show they cannot move: it steps from the Now last asked, and does nothing past either end', () => {
    const onBack = vi.fn();
    const onNext = vi.fn();
    // Next pressed from not started, Main not answered yet: Now still shows not started, Back dimmed.
    const before = FlowNowNext({ flow: flow(), now: null, size: 'panel', onBack, onNext });
    find(before, 'flow-back-button')?.onClick?.();
    expect(onBack).toHaveBeenCalledTimes(1);
    // On the last item, Back pressed and Next at once: both go to the store, which decides.
    const last = FlowNowNext({ flow: flow(), now: 2, size: 'panel', onBack, onNext });
    find(last, 'flow-next-button')?.onClick?.();
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});

describe('Now and Next up on a paired phone: the same, live, read only', () => {
  const phone = (now: number | null, over: Partial<FlowNowNextProps> = {}) =>
    draw({ now, size: 'phone', onBack: undefined, onNext: undefined, ...over });

  it('says the same as the panel for every Now, larger, with its own test ids', () => {
    for (const now of [null, 0, 1, 2]) {
      const panel = draw({ now });
      const html = phone(now);
      expect(line(html, 'remote-flow-now')).toBe(line(panel, 'flow-now'));
      expect(line(html, 'remote-flow-next')).toBe(line(panel, 'flow-next'));
      expect(html).toContain('data-testid="remote-flow-now-next"');
      expect(html).not.toContain('data-testid="flow-now');
    }
    // A phone's own sizes: Now at the remote's text size, Next up larger still.
    const html = phone(0);
    expect(tag(html, 'remote-flow-now')).toMatch(/class="[^"]*text-base/u);
    expect(tag(html, 'remote-flow-next')).toMatch(/class="[^"]*text-lg[^"]*font-bold/u);
    expect(tag(html, 'remote-flow-next')).toContain('data-video="true"');
  });

  it('has no Back or Next: read only', () => {
    const html = phone(1);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('flow-back-button');
    expect(html).not.toContain('flow-next-button');
  });

  it('is said to a screen reader where it is the one in sight, and not where another is said (live false)', () => {
    expect(phone(0)).toContain('aria-live="polite"');
    expect(phone(0, { live: false })).not.toContain('aria-live');
    expect(draw({ now: 0, live: false })).not.toContain('aria-live');
  });

  it('in More, not said again while the Sabha flow’s sheet is over it (the sheet’s is said)', () => {
    const snapshot = { flow: flow(), state: { flowId: 'flow-0001-test', now: 0 } };
    const more = (sheetOpen: boolean) =>
      renderToStaticMarkup(createElement(FlowSectionView, { snapshot, problem: null, sheetOpen }));
    expect(more(false)).toContain('aria-live="polite"');
    expect(words(more(false))).toContain('Now: 1 · Opening · Placeholder words one');
    expect(more(true)).not.toContain('aria-live');
    // Still drawn under it, as it was.
    expect(words(more(true))).toContain('Next up: 2 · Video · Placeholder clip · 15 min · Speaker B');
  });
});
