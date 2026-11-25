import { describe, expect, it } from 'vitest';
import type { SabhaFlow } from './sabha-flow';
import {
  cellHeader,
  flowLine,
  isVideoText,
  lineText,
  nextText,
  nowNext,
  nowText,
  pagesCapped,
  pagesShown,
  textLang,
} from './sabha-flow-lines';

/*
 * Sabha flow's lines (QA23-FLOW-1 and -2), shared by the operator window's panel and the paired phone's view: an item as
 * "1 · Program · Details · Duration · Presenter", Now and Next up, and the language of a cell. Placeholder words only.
 */

const flow = (over: Partial<SabhaFlow> = {}): SabhaFlow => ({
  id: 'flow-0001-test',
  fileName: 'placeholder-flow.pdf',
  pageCount: 1,
  status: 'read',
  lang: 'en',
  title: 'Placeholder evening',
  subtitle: 'A test running order',
  headers: ['No.', 'Program', 'Details', 'Duration', 'Presenter'],
  items: [
    { no: '1', cells: ['Opening', 'Placeholder words one', '10 min', 'Speaker A'] },
    // A merged Duration and Presenter cell, repeated on both rows it spans (the reader repeats it).
    { no: '2', cells: ['Video', 'Placeholder clip', '15 min', 'Speaker B'] },
    { no: '3', cells: ['Talk', 'Placeholder words three', '15 min', 'Speaker B'] },
    { no: '4', cells: ['Closing', '', '5 min', 'Speaker C'] },
  ],
  total: 'Total 45 min',
  ...over,
});

describe('an item as one line', () => {
  it('reads "1 · Program · Details · Duration · Presenter" in full, and the number with two cells short', () => {
    const f = flow();
    const full = flowLine(f, 0, 'full');
    expect(full).not.toBeNull();
    expect(full && lineText(full)).toBe('1 · Opening · Placeholder words one · 10 min · Speaker A');
    const short = flowLine(f, 0, 'short');
    expect(short && lineText(short)).toBe('1 · Opening · Placeholder words one');
  });

  it('shows a merged cell on each row it covers, and leaves an empty cell out', () => {
    const f = flow();
    expect(lineText(flowLine(f, 1, 'full') ?? { index: 1, no: '', parts: [], video: false })).toContain(
      '15 min · Speaker B',
    );
    expect(lineText(flowLine(f, 2, 'full') ?? { index: 2, no: '', parts: [], video: false })).toBe(
      '3 · Talk · Placeholder words three · 15 min · Speaker B',
    );
    expect(lineText(flowLine(f, 3, 'full') ?? { index: 3, no: '', parts: [], video: false })).toBe(
      '4 · Closing · 5 min · Speaker C',
    );
  });

  it('has no line for an index outside the items', () => {
    expect(flowLine(flow(), 4, 'full')).toBeNull();
    expect(flowLine(flow(), -1, 'full')).toBeNull();
  });

  it('pairs each cell with its header after the number column, and with the same header when there is no number column', () => {
    const f = flow();
    expect(cellHeader(f, 0)).toBe('Program');
    expect(cellHeader(f, 3)).toBe('Presenter');
    expect(cellHeader(flow({ headers: ['Program', 'Details', 'Duration', 'Presenter'] }), 0)).toBe('Program');
    expect(cellHeader(flow({ headers: [] }), 0)).toBeUndefined();
  });
});

describe('Now and Next up (QA23-FLOW-2)', () => {
  it('before anything is Now: Now says not started, Next up is the first item in full', () => {
    const nn = nowNext(flow(), null);
    expect(nn.now).toBeNull();
    expect(nn.last).toBe(false);
    expect(nowText(nn)).toBe('Now: not started');
    expect(nextText(nn)).toBe('Next up: 1 · Opening · Placeholder words one · 10 min · Speaker A');
  });

  it('on 1: "Now: 1 · Program · Details" and "Next up: 2 · Program · Details · Duration · Presenter"', () => {
    const nn = nowNext(flow(), 0);
    expect(nowText(nn)).toBe('Now: 1 · Opening · Placeholder words one');
    expect(nextText(nn)).toBe('Next up: 2 · Video · Placeholder clip · 15 min · Speaker B');
  });

  it('a Video row is marked as the video', () => {
    expect(nowNext(flow(), 0).next?.video).toBe(true);
    expect(nowNext(flow(), 1).next?.video).toBe(false);
  });

  it('on the last item: Next up says "Last item"', () => {
    const nn = nowNext(flow(), 3);
    expect(nn.last).toBe(true);
    expect(nn.next).toBeNull();
    // Now is its Program and Details: an empty Details is left out, nothing else takes its place.
    expect(nowText(nn)).toBe('Now: 4 · Closing');
    expect(nextText(nn)).toBe('Last item');
  });

  it('a Now outside the items counts as not started', () => {
    expect(nowNext(flow(), 9).now).toBeNull();
    expect(nowNext(flow(), 9).next?.index).toBe(0);
  });

  it('with no items there is nothing next and it is not the last item', () => {
    const nn = nowNext(flow({ items: [], status: 'no-items' }), null);
    expect(nn.now).toBeNull();
    expect(nn.next).toBeNull();
    expect(nn.last).toBe(false);
    expect(nextText(nn)).toBe('Next up: nothing');
  });
});

describe('a video named in English, Gujarati or Hindi', () => {
  it('knows the word at the start of a cell, in any case, and nothing else', () => {
    expect(isVideoText('Video')).toBe(true);
    expect(isVideoText('video: placeholder')).toBe(true);
    expect(isVideoText('વિડિયો')).toBe(true);
    expect(isVideoText('વીડિયો')).toBe(true);
    expect(isVideoText('वीडियो')).toBe(true);
    expect(isVideoText('Videography talk')).toBe(false);
    expect(isVideoText('Talk')).toBe(false);
    expect(isVideoText('')).toBe(false);
  });
});

describe('the language of a cell', () => {
  it('is the PDF’s own when it has one language', () => {
    expect(textLang('Placeholder', 'gu')).toBe('gu');
    expect(textLang('Placeholder', 'hi')).toBe('hi');
    expect(textLang('Placeholder', 'en')).toBe('en');
  });

  it('in a mixed PDF is each cell’s own script: Gujarati, Devanagari (hi), else English', () => {
    expect(textLang('કાર્યક્રમ', 'mixed')).toBe('gu');
    expect(textLang('कार्यक्रम', 'mixed')).toBe('hi');
    expect(textLang('10 min', 'mixed')).toBe('en');
  });
});

describe('the pages shown (a22-review-flow round 2, M2: the panel and the phone the same)', () => {
  it('are the pages Main drew: at most the first 20, said when there are more', () => {
    expect(pagesShown(flow({ pageCount: 600 }))).toBe(20);
    expect(pagesShown(flow({ pageCount: 20 }))).toBe(20);
    expect(pagesShown(flow({ pageCount: 3 }))).toBe(3);
    expect(pagesShown(flow({ pageCount: 0 }))).toBe(0);
    expect(pagesCapped(flow({ pageCount: 600 }))).toBe('Only the first 20 pages are shown.');
    expect(pagesCapped(flow({ pageCount: 20 }))).toBeNull();
  });
});
