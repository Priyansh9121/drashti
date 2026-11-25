import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SabhaFlow, SabhaFlowStatus } from '../../../shared/sabha-flow';
import { FlowNowNext, FlowReadList, FlowStatusNotice, flowViews, statusWords } from './FlowViews';

/*
 * The Sabha flow panel's views (QA23-FLOW-1 and -2), drawn as the operator window draws them: the read list, Now and
 * Next up, and the plain words for a PDF Drashti could not read. Placeholder words only, never a real running order.
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
const nowNext = (f: SabhaFlow, now: number | null) =>
  renderToStaticMarkup(
    createElement(FlowNowNext, { flow: f, now, onBack: () => undefined, onNext: () => undefined }),
  );
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

describe('Now and Next up (QA23-FLOW-2)', () => {
  it('on 1 shows "Now: 1 · Program · Details" and, larger, "Next up: 2 · Program · Details · Duration · Presenter"', () => {
    const html = nowNext(flow(), 0);
    const now = /data-testid="flow-now"[^>]*>(.*?)<\/p>/u.exec(html)?.[1] ?? '';
    const next = /data-testid="flow-next"[^>]*>(.*?)<\/p>/u.exec(html)?.[1] ?? '';
    expect(words(now).replace(/\s+/gu, ' ').trim()).toBe('Now: 1 · Opening · Placeholder words one');
    expect(words(next).replace(/\s+/gu, ' ').trim()).toBe(
      'Next up: 2 · Video · Placeholder clip · 15 min · Speaker B',
    );
    // Next up stands out: larger and bolder than Now.
    expect(html).toMatch(/data-testid="flow-next"[^>]*class="[^"]*text-base[^"]*font-bold/u);
  });

  it('shows a Video row as the video', () => {
    expect(nowNext(flow(), 0)).toContain('data-video="true"');
    expect(nowNext(flow(), 1)).not.toContain('data-video="true"');
  });

  it('on the last item says "Last item", and Next is off', () => {
    const html = nowNext(flow(), 2);
    expect(words(html)).toContain('Last item');
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*data-testid="flow-next-button"|<button[^>]*data-testid="flow-next-button"[^>]*disabled=""/u,
    );
  });

  it('before anything is Now: Next up is the first item, and Back is off', () => {
    const html = nowNext(flow(), null);
    expect(words(html)).toContain('Now: not started');
    expect(words(html)).toContain('Next up: 1 · Opening');
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*data-testid="flow-back-button"|<button[^>]*data-testid="flow-back-button"[^>]*disabled=""/u,
    );
  });

  it('says its changes to a screen reader, and its buttons are named with the words they show', () => {
    const html = nowNext(flow(), 0);
    expect(html).toContain('aria-live="polite"');
    expect(html).toMatch(/<button[^>]*aria-label="Back one item"/u);
    expect(html).toMatch(/<button[^>]*aria-label="Next item"/u);
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
    expect(flowViews('read')).toEqual(['list', 'page']);
  });
});
