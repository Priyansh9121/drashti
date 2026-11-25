import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SabhaFlow, SabhaFlowStatus } from '../../../shared/sabha-flow';
import { FlowReadList, FlowStatusNotice, flowViews, statusWords } from './FlowViews';

/*
 * The Sabha flow panel's views (QA23-FLOW-1 and -2), drawn as the operator window draws them: the read list and the
 * plain words for a PDF Drashti could not read (Now and Next up: flow-now-next.test.ts). Placeholder words only, never
 * a real running order.
 */

const flow = (over: Partial<SabhaFlow> = {}): SabhaFlow => ({
  id: 'flow-0001-test',
  fileName: 'placeholder-flow.pdf',
  pageCount: 1,
  drawnPages: 1,
  status: 'read',
  lang: 'en',
  title: 'Placeholder evening',
  subtitle: 'A test running order',
  headers: ['No.', 'Program', 'Details', 'Duration', 'Presenter'],
  items: [
    { no: '1', cells: ['Opening', 'Placeholder words one', '10 min', 'Speaker A'] },
    { no: '2', cells: ['Video', 'Placeholder clip', '15 min', 'Speaker B'] },
    { no: '3', cells: ['Talk', 'Placeholder words three', '15 min', 'Speaker B'] },
  ],
  total: 'Total 40 min',
  ...over,
});

const list = (f: SabhaFlow, now: number | null = null) =>
  renderToStaticMarkup(createElement(FlowReadList, { flow: f, now, onPick: () => undefined }));
/** The text a person reads (tags out, the separators' hidden commas out). */
const words = (html: string) =>
  html
    .replace(/<span class="sr-only">[^<]*<\/span>/gu, '')
    .replace(/<[^>]+>/gu, '')
    .replace(/&#x27;/gu, '’')
    .replace(/&amp;/gu, '&');
const rows = (html: string) =>
  [...html.matchAll(/<li[^>]*>(.*?)<\/li>/gu)].map((m) =>
    words(m[1] ?? '')
      .replace(/\s+/gu, ' ')
      .trim(),
  );

describe('the read list', () => {
  it('shows each numbered item as "1 · Program · Details · Duration · Presenter", in order, with the total at the bottom', () => {
    const html = list(flow());
    expect(rows(html)).toEqual([
      '1 · Opening · Placeholder words one · 10 min · Speaker A',
      '2 · Video · Placeholder clip · 15 min · Speaker B',
      '3 · Talk · Placeholder words three · 15 min · Speaker B',
    ]);
    expect(html).toContain('data-testid="flow-total"');
    expect(html.indexOf('Total 40 min')).toBeGreaterThan(html.lastIndexOf('</li>'));
    expect(words(html)).toContain('Placeholder evening');
    expect(words(html)).toContain('A test running order');
  });

  it('is an ordered list a screen reader can go through, each row a button that marks it Now', () => {
    const html = list(flow());
    expect(html).toMatch(/<ol[^>]*aria-label="Sabha flow items"/u);
    expect(html.match(/<button[^>]*data-testid="flow-row"/gu)?.length).toBe(3);
    // The separators are hidden from a screen reader, which reads a comma between the cells instead.
    expect(html).toContain('<span aria-hidden="true"> · </span>');
    expect(html).toContain('<span class="sr-only">, </span>');
  });

  it('marks the Now row (aria-current), and no row before anything is Now', () => {
    expect(list(flow())).not.toContain('aria-current');
    const html = list(flow(), 1);
    expect(html.match(/aria-current="step"/gu)?.length).toBe(1);
    expect(html).toMatch(/<button[^>]*aria-current="step"[^>]*>.*?2/u);
  });

  it('is in the PDF’s own language: Gujarati and Hindi words carry lang gu and hi', () => {
    expect(list(flow({ lang: 'gu' }))).toMatch(/<div[^>]*lang="gu"/u);
    expect(list(flow({ lang: 'hi' }))).toMatch(/<div[^>]*lang="hi"/u);
    // A mixed PDF: each cell its own.
    const mixed = list(
      flow({
        lang: 'mixed',
        items: [{ no: '1', cells: ['કાર્યક્રમ', 'कार्यक्रम', '10 min', 'Speaker A'] }],
      }),
    );
    expect(mixed).toContain('<span lang="gu">કાર્યક્રમ</span>');
    expect(mixed).toContain('<span lang="hi">कार्यक्रम</span>');
  });
});

describe('a PDF Drashti could not read', () => {
  it('says so in plain words, and then shows the PDF page only', () => {
    const cases: [SabhaFlowStatus, RegExp][] = [
      ['no-text', /no words Drashti can read/u],
      ['unreadable', /couldn’t read this PDF’s words/u],
      ['no-items', /no numbered items/u],
    ];
    for (const [status, said] of cases) {
      expect(statusWords(status)).toMatch(said);
      expect(statusWords(status)).toMatch(/Its page is shown instead\.$/u);
      expect(renderToStaticMarkup(createElement(FlowStatusNotice, { status }))).toMatch(said);
      expect(flowViews(status)).toEqual(['page']);
    }
    expect(statusWords('read')).toBeNull();
    expect(renderToStaticMarkup(createElement(FlowStatusNotice, { status: 'read' }))).toBe('');
    // More text than a running order holds is said as that, not as no numbered items (core's tooMuchText).
    expect(statusWords('no-items', true)).toBe(
      'This PDF has more text than a running order holds, so Drashti read none of it. Its page is shown instead.',
    );
    expect(statusWords('no-items', false)).toMatch(/found no numbered items/u);
    const more = renderToStaticMarkup(
      createElement(FlowStatusNotice, { status: 'no-items', tooMuchText: true }),
    );
    expect(more).toContain('more text than a running order holds');
    expect(more).not.toContain('numbered items');
    expect(flowViews('read')).toEqual(['list', 'page']);
  });
});
