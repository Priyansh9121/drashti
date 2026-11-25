import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SabhaFlow } from '../../../shared/sabha-flow';
import { FlowPage } from './FlowPage';

/*
 * The Sabha flow's PDF page view (a22-review-flow round 2, M2): only the pages Main drew (the first 20), each asked for
 * once, never a row for every page of a long PDF, and one plain line saying so. Placeholder flows only.
 */

const flow = (pageCount: number): SabhaFlow => ({
  id: 'flow-0001-test',
  fileName: 'placeholder-scan.pdf',
  pageCount,
  status: 'no-text',
  lang: 'en',
  headers: [],
  items: [],
});

const draw = (f: SabhaFlow) => renderToStaticMarkup(createElement(FlowPage, { flow: f }));
const slots = (html: string) => html.match(/Drawing page \d+…/gu)?.length ?? 0;

describe('the PDF page view', () => {
  it('of a 600-page scan holds the 20 pages drawn, says only the first 20 are shown, and none "couldn’t be drawn"', () => {
    const html = draw(flow(600));
    expect(slots(html)).toBe(20);
    expect(html).toContain('Only the first 20 pages are shown.');
    expect(html).not.toContain('couldn’t be drawn');
  });

  it('of a 3-page PDF holds its 3 pages and says nothing of the rest', () => {
    const html = draw(flow(3));
    expect(slots(html)).toBe(3);
    expect(html).not.toContain('Only the first');
  });
});
