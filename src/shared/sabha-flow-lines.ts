import type { SabhaFlow, SabhaFlowLang, SabhaFlowStatus } from './sabha-flow';
import { nextUpIndex, nowWithin, SABHA_FLOW_LIMITS } from './sabha-flow';

/*
 * Sabha flow's lines (alpha.23, QA23-FLOW-1 and QA23-FLOW-2), the same in the operator window's panel and on a paired
 * phone: an item as "1 · Program · Details · Duration · Presenter" (its cells as the PDF has them, a merged cell on
 * each row it covers, an empty one left out), Now as its number and first two cells, Next up in full, and "Last item"
 * after the last. A row whose Program (or Details) begins with the word for a video, in English, Gujarati or Hindi, is
 * marked as the video. The words of an item stay in the PDF's own language (textLang says which, for its lang
 * attribute); the labels around them are Drashti's. And the plain words for a PDF Drashti could not read (then only its
 * page is shown), for no flow yet, and how many pages the page view shows.
 */

/** Between an item's number and its cells, and between the cells. */
export const FLOW_SEPARATOR = ' · ';

/** An item as one line: its index in the flow's items, its number, and its cells that say something. */
export interface FlowLine {
  index: number;
  no: string;
  parts: string[];
  /** Its Program (or Details) names a video. */
  video: boolean;
}

/** Where the sabha is: Now (null: not started), Next up (null: none), and whether Now is the last item. */
export interface NowNext {
  now: FlowLine | null;
  next: FlowLine | null;
  last: boolean;
}

export const NOW_LABEL = 'Now';
export const NEXT_LABEL = 'Next up';
export const NOT_STARTED = 'not started';
export const LAST_ITEM = 'Last item';
export const NOTHING_NEXT = 'nothing';

/** The word for a video at the start of a cell: English, Gujarati (its spellings) and Hindi. */
const VIDEO = /^(?:video|વિડિયો|વીડિયો|વિડીયો|વીડીયો|विडियो|वीडियो|विडीयो)(?![\p{L}\p{M}])/iu;

export const isVideoText = (text: string): boolean => VIDEO.test(text.trim());

/**
 * An item as a line: its number and its cells ('full'), or its number and its first two cells ('short': Now). Null
 * for an index outside the items.
 */
export function flowLine(flow: SabhaFlow, index: number, length: 'short' | 'full'): FlowLine | null {
  const item = Number.isInteger(index) && index >= 0 ? flow.items[index] : undefined;
  if (!item) return null;
  const cells = length === 'short' ? item.cells.slice(0, 2) : item.cells;
  return {
    index,
    no: item.no,
    parts: cells.map((c) => c.trim()).filter((c) => c !== ''),
    video: item.cells.slice(0, 2).some(isVideoText),
  };
}

/** A line as plain text: "1 · Program · Details". */
export const lineText = (line: FlowLine): string => [line.no, ...line.parts].join(FLOW_SEPARATOR);

/**
 * A cell's header: the header after the number's own column when the PDF has one (one header more than cells), else
 * the header in the same place; none for a numbered list.
 */
export function cellHeader(flow: SabhaFlow, cell: number): string | undefined {
  const widest = Math.max(0, ...flow.items.map((i) => i.cells.length));
  const offset = flow.headers.length > widest ? 1 : 0;
  return flow.headers[cell + offset];
}

/** Now (short) and Next up (in full) for a Now as marked. */
export function nowNext(flow: SabhaFlow, now: number | null): NowNext {
  const at = nowWithin(flow, now);
  const next = nextUpIndex(flow, at);
  return {
    now: at === null ? null : flowLine(flow, at, 'short'),
    next: next === null ? null : flowLine(flow, next, 'full'),
    last: at !== null && next === null,
  };
}

/** "Now: 1 · Program · Details", or "Now: not started". */
export const nowText = (nn: NowNext): string => `${NOW_LABEL}: ${nn.now ? lineText(nn.now) : NOT_STARTED}`;

/** "Next up: 2 · Program · Details · Duration · Presenter", "Last item", or "Next up: nothing" with no items. */
export function nextText(nn: NowNext): string {
  if (nn.last) return LAST_ITEM;
  return `${NEXT_LABEL}: ${nn.next ? lineText(nn.next) : NOTHING_NEXT}`;
}

const GUJARATI = /[઀-૿]/u;
const DEVANAGARI = /[ऀ-ॿ]/u;

/**
 * The language of an item's words, for their lang attribute: the PDF's own; in a mixed PDF, each cell's by its script
 * (Gujarati gu, Devanagari hi, anything else en).
 */
export function textLang(text: string, lang: SabhaFlowLang): 'en' | 'gu' | 'hi' {
  if (lang !== 'mixed') return lang;
  if (GUJARATI.test(text)) return 'gu';
  if (DEVANAGARI.test(text)) return 'hi';
  return 'en';
}

/** Said where there is no flow yet (the panel says how to choose one; a phone, that the operator has not). */
export const NO_FLOW = 'No Sabha flow yet';

/** The panel's (and a phone's) two views of a flow. */
export type FlowView = 'list' | 'page';

/** The views a flow has: its read list and page, or only its page when nothing could be read from it. */
export const flowViews = (status: SabhaFlowStatus): FlowView[] =>
  status === 'read' ? ['list', 'page'] : ['page'];

/**
 * Why there is no read list, in plain words; null when it was read. `tooMuchText` (with 'no-items'): the PDF holds
 * more text than a running order does, so none was read: said as that, not as no numbered items.
 */
export function statusWords(status: SabhaFlowStatus, tooMuchText = false): string | null {
  switch (status) {
    case 'no-text':
      return 'This PDF has no words Drashti can read: it may be a scan, or pictures of pages. Its page is shown instead.';
    case 'unreadable':
      return 'Drashti couldn’t read this PDF’s words: its fonts don’t say which letters they draw, so they come out wrong. Its page is shown instead.';
    case 'no-items':
      return tooMuchText
        ? 'This PDF has more text than a running order holds, so Drashti read none of it. Its page is shown instead.'
        : 'Drashti read this PDF but found no numbered items in it. Its page is shown instead.';
    case 'read':
      return null;
  }
}

/**
 * The pages a flow's page view shows: those Main drew when the PDF was chosen (drawnPages: the first, at most
 * SABHA_FLOW_LIMITS.maxPages), never more than the PDF has (a22-review-flow M2: a 600-page scan is never 600 asks, nor
 * a line for each page not drawn).
 */
export const pagesShown = (flow: SabhaFlow): number =>
  Math.max(0, Math.min(flow.drawnPages, flow.pageCount, SABHA_FLOW_LIMITS.maxPages));

/** Said under the pages when the PDF has more than were drawn (or none could be); null otherwise. */
export function pagesCapped(flow: SabhaFlow): string | null {
  const shown = pagesShown(flow);
  if (flow.pageCount <= shown) return null;
  if (shown === 0) return 'Drashti couldn’t draw this PDF’s pages.';
  return shown === 1 ? 'Only the first page is shown.' : `Only the first ${String(shown)} pages are shown.`;
}
