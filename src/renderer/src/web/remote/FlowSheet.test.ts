import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SabhaFlow, SabhaFlowSnapshot } from '../../../../shared/sabha-flow';
import { FLOW_PHONE_WORDS, FlowSectionView, type FlowShown, FlowSheetView } from './FlowSheet';

/*
 * Sabha flow on a phone (alpha.23), drawn as the phone draws it: in More, Now and Next up (a video's row marked) or
 * plain words; in its sheet the read list (Now and Next up marked, each part with the PDF's own lang, merged cells as
 * the reader repeats them, the total) or, for a PDF Drashti could not read, the page alone with plain words. Read only:
 * no row is a button. Drawn from what the phone's store keeps (flow-store.ts), as given here. Placeholder words only,
 * made-up ids.
 */

const FLOW: SabhaFlow = {
  id: 'flow-placeholder-0001',
  fileName: 'Placeholder evening order.pdf',
  pageCount: 2,
  status: 'read',
  lang: 'mixed',
  title: 'Placeholder Evening',
  headers: ['No.', 'Program', 'Details', 'Duration', 'Presenter'],
  items: [
    { no: '1', cells: ['Placeholder opening', 'Placeholder words', '5 min', 'Placeholder A'] },
    { no: '2', cells: ['Video', 'Placeholder clip', '20 min', 'Placeholder B'] },
    { no: '3', cells: ['નમૂના કાર્યક્રમ', 'નમૂના શબ્દો', '20 min', 'Placeholder B'] },
  ],
  total: 'Placeholder total: 45 min',
};

const SCAN: SabhaFlow = { ...FLOW, id: 'flow-placeholder-0002', status: 'no-text', headers: [], items: [] };

/** What is drawn, without what only a screen reader hears, its tags taken out. */
const words = (html: string): string =>
  html
    .replace(/<span class="sr-only">[^<]*<\/span>/gu, '')
    .replace(/<[^>]+>/gu, '')
    .replace(/&#x27;/gu, '’')
    .replace(/\s+/gu, ' ');

let shown: FlowShown = { snapshot: null, problem: null, view: 'list', page: 0, zoom: 1, pictures: {} };

const section = () => renderToStaticMarkup(createElement(FlowSectionView, shown));
const sheet = () => renderToStaticMarkup(createElement(FlowSheetView, shown));

function showing(snapshot: SabhaFlowSnapshot | null, over: Partial<FlowShown> = {}) {
  shown = { snapshot, problem: null, view: 'list', page: 0, zoom: 1, pictures: {}, ...over };
}

describe('Sabha flow on a phone (alpha.23), drawn', () => {
  it('says it is reading, then that there is none, with nothing to open', () => {
    showing(null);
    expect(words(section())).toContain(FLOW_PHONE_WORDS.reading);
    showing({ flow: null, state: null });
    const html = section();
    expect(words(html)).toContain('There is no Sabha flow yet');
    expect(html).not.toContain('remote-open-flow');
  });

  it('shows Now and, larger, Next up in full as the computer marks them, a video’s row marked, and the sheet’s button', () => {
    showing({ flow: FLOW, state: { flowId: FLOW.id, now: 0 } });
    const html = section();
    expect(words(html)).toContain('Placeholder evening order.pdf');
    expect(words(html)).toContain('Now: 1 · Placeholder opening · Placeholder words');
    expect(words(html)).toContain('Next up: 2 · Video · Placeholder clip · 20 min · Placeholder B');
    expect(html).toMatch(/data-testid="remote-flow-next" data-video="true"/u);
    expect(html).toContain('data-testid="remote-open-flow"');
    // Nothing marked yet: the first is next. The last marked: Last item.
    showing({ flow: FLOW, state: { flowId: FLOW.id, now: null } });
    expect(words(section())).toContain('Now: not started');
    expect(words(section())).toContain('Next up: 1 · Placeholder opening');
    showing({ flow: FLOW, state: { flowId: FLOW.id, now: 2 } });
    expect(words(section())).toContain('Last item');
  });

  it('says plainly when Drashti could not read the PDF’s words, and still opens its page', () => {
    showing({ flow: SCAN, state: { flowId: SCAN.id, now: null } });
    const html = section();
    expect(words(html)).toContain('no words Drashti can read');
    expect(html).not.toContain('remote-flow-next');
    expect(html).toContain('data-testid="remote-open-flow"');
  });

  it('draws the read list read only: Now and Next up marked, each part in its own language, the total at the bottom', () => {
    showing({ flow: FLOW, state: { flowId: FLOW.id, now: 0 } });
    const html = sheet();
    expect(html).toContain('data-testid="remote-flow-sheet"');
    expect(html).toContain('aria-selected="true" data-testid="remote-flow-view-list"');
    const rows = html.split('data-testid="remote-flow-row"').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/^ aria-current="step"/u);
    expect(rows[1]).toMatch(/^ data-next="true"/u);
    expect(words(`<li ${rows[2] ?? ''}`)).toContain(
      '3 · નમૂના કાર્યક્રમ · નમૂના શબ્દો · 20 min · Placeholder B',
    );
    // A mixed PDF: each part's own lang, by its script.
    expect(html).toContain('<span lang="gu">નમૂના કાર્યક્રમ</span>');
    expect(html).toContain('<span lang="en">Placeholder clip</span>');
    expect(words(html)).toContain('Placeholder total: 45 min');
    // Read only: the rows are not buttons.
    expect(rows.join('')).not.toMatch(/<button[^>]*remote-flow-row/u);
  });

  it('shows a scan’s page alone, with plain words, and no read list to switch to', () => {
    showing({ flow: SCAN, state: { flowId: SCAN.id, now: null } }, { view: 'page' });
    const html = sheet();
    expect(html).toContain('data-testid="remote-flow-status"');
    expect(html).not.toContain('remote-flow-view-list');
    expect(html).toContain('data-testid="remote-flow-page"');
    expect(words(html)).toContain(FLOW_PHONE_WORDS.drawing);
  });

  it('draws the page it has, at its zoom, and says so when it could not be had', () => {
    showing(
      { flow: FLOW, state: { flowId: FLOW.id, now: 0 } },
      { view: 'page', zoom: 1.5, pictures: { [`${FLOW.id}:0`]: 'blob:placeholder-0' } },
    );
    const html = sheet();
    expect(html).toContain('src="blob:placeholder-0"');
    expect(html).toContain('alt="Page 1 of 2 of the Sabha flow"');
    expect(html).toContain('width:150%');
    showing(
      { flow: FLOW, state: { flowId: FLOW.id, now: 0 } },
      { view: 'page', pictures: { [`${FLOW.id}:0`]: 'failed' } },
    );
    expect(words(sheet())).toContain(FLOW_PHONE_WORDS.noPage);
  });

  it('says there is none once the flow is removed while the sheet is open', () => {
    showing({ flow: null, state: null });
    expect(words(sheet())).toContain('There is no Sabha flow yet');
  });
});
