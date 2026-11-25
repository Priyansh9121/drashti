import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SabhaFlowLang, SabhaFlowStatus } from '../../src/shared/sabha-flow';
import {
  flowListPage,
  flowScanPage,
  flowTablePage,
  type FlowPdfOptions,
  type FlowPdfPage,
  makeFlowPdf,
} from '../../src/main/documents/testing/sabha-flow-pdfs';

/*
 * Sabha flow (alpha.23, QA23-FLOW-1 and QA23-FLOW-2): the placeholder running orders the end-to-end scenarios choose
 * (made by a22-flow-core's maker, tests only: pdf-lib and the bundled Noto fonts with their Unicode maps, a table's
 * borders as lines or thin boxes, or none), what each must read as, and the lines the panel and a phone show for them.
 * Placeholder words only, never a real running order; "Flowcheck" marks the English words, so a screen showing any of
 * them is caught. No Playwright here: the fixtures are plain data and files.
 */

/** A placeholder running order: its pages and how it is written, and what Drashti must read from it. */
export interface FlowFixture {
  fileName: string;
  pages: FlowPdfPage[];
  options?: FlowPdfOptions;
  status: SabhaFlowStatus;
  /** The language its words are in (each item's lang). */
  lang: SabhaFlowLang;
  title?: string;
  subtitle?: string;
  total?: string;
  /** Each item: its number first, then its cells (a merged cell on each row it covers). */
  items: string[][];
}

const FIVE = [44, 140, 190, 70, 106];

/**
 * English: a table with its borders as lines, a title, a subtitle and a total; row 2 is a video, its Duration merged
 * over rows 2-3 and its Presenter over rows 2-4 (one cell each in the PDF, repeated on every row it covers).
 */
export const ENGLISH: FlowFixture = {
  fileName: 'Flowcheck English order.pdf',
  pages: [
    flowTablePage({
      title: 'Flowcheck evening',
      subtitle: 'Placeholder hall, placeholder date',
      headers: ['No.', 'Program', 'Details', 'Duration', 'Presenter'],
      widths: FIVE,
      rows: [
        ['1', 'Opening', 'Flowcheck words one', '5 min', 'Presenter A'],
        ['2', 'Video', 'Flowcheck clip', { text: '10 min', rows: 2 }, { text: 'Presenter B', rows: 3 }],
        ['3', 'Talk', 'Flowcheck words three', null, null],
        ['4', 'Reading', 'Flowcheck words four', '15 min', null],
        ['5', 'Closing', 'Flowcheck words five', '5 min', 'Presenter C'],
      ],
      total: 'Total 35 min',
      borders: 'lines',
    }),
  ],
  status: 'read',
  lang: 'en',
  title: 'Flowcheck evening',
  subtitle: 'Placeholder hall, placeholder date',
  total: 'Total 35 min',
  items: [
    ['1', 'Opening', 'Flowcheck words one', '5 min', 'Presenter A'],
    ['2', 'Video', 'Flowcheck clip', '10 min', 'Presenter B'],
    ['3', 'Talk', 'Flowcheck words three', '10 min', 'Presenter B'],
    ['4', 'Reading', 'Flowcheck words four', '15 min', 'Presenter B'],
    ['5', 'Closing', 'Flowcheck words five', '5 min', 'Presenter C'],
  ],
};

/**
 * Gujarati ("sample programme", "sample", "speaker one"...: placeholder words): a table drawn with thin filled boxes
 * as Word draws its borders, Gujarati numbers, merged cells with their words in their middle.
 */
export const GUJARATI: FlowFixture = {
  fileName: 'Flowcheck Gujarati order.pdf',
  pages: [
    flowTablePage({
      title: 'નમૂનો કાર્યક્રમ',
      subtitle: 'નમૂનો સભા',
      headers: ['ક્રમ', 'કાર્યક્રમ', 'વિગત', 'સમય', 'વક્તા'],
      widths: FIVE,
      rows: [
        ['૧', 'પહેલો કાર્યક્રમ', 'નમૂનો વિગત', '૫ મિનિટ', 'વક્તા એક'],
        ['૨', 'બીજો કાર્યક્રમ', 'નમૂનો', { text: '૧૦ મિનિટ', rows: 3 }, 'વક્તા બે'],
        ['૩', 'ત્રીજો કાર્યક્રમ', 'નમૂનો', null, 'વક્તા ત્રણ'],
        ['૪', 'ચોથો કાર્યક્રમ', 'નમૂનો', null, { text: 'વક્તા ચાર', rows: 2 }],
        ['૫', 'પાંચમો કાર્યક્રમ', 'નમૂનો', '૫ મિનિટ', null],
      ],
      total: 'કુલ સમય: ૩૦ મિનિટ',
      borders: 'boxes',
      mergedAlign: 'middle',
    }),
  ],
  status: 'read',
  lang: 'gu',
  title: 'નમૂનો કાર્યક્રમ',
  subtitle: 'નમૂનો સભા',
  total: 'કુલ સમય: ૩૦ મિનિટ',
  items: [
    ['૧', 'પહેલો કાર્યક્રમ', 'નમૂનો વિગત', '૫ મિનિટ', 'વક્તા એક'],
    ['૨', 'બીજો કાર્યક્રમ', 'નમૂનો', '૧૦ મિનિટ', 'વક્તા બે'],
    ['૩', 'ત્રીજો કાર્યક્રમ', 'નમૂનો', '૧૦ મિનિટ', 'વક્તા ત્રણ'],
    ['૪', 'ચોથો કાર્યક્રમ', 'નમૂનો', '૧૦ મિનિટ', 'વક્તા ચાર'],
    ['૫', 'પાંચમો કાર્યક્રમ', 'નમૂનો', '૫ મિનિટ', 'વક્તા ચાર'],
  ],
};

/** Hindi (placeholder words): a table with no borders at all, a merged cell in its middle, an empty last cell. */
export const HINDI: FlowFixture = {
  fileName: 'Flowcheck Hindi order.pdf',
  pages: [
    flowTablePage({
      title: 'नमूना कार्यक्रम',
      headers: ['क्रम', 'कार्यक्रम', 'विवरण', 'समय', 'वक्ता'],
      widths: FIVE,
      rows: [
        ['1', 'पहला कार्यक्रम', 'नमूना विवरण', '5 मिनट', 'वक्ता एक'],
        ['2', 'दूसरा कार्यक्रम', 'नमूना', { text: '10 मिनट', rows: 2 }, 'वक्ता दो'],
        ['3', 'तीसरा कार्यक्रम', 'नमूना', null, 'वक्ता तीन'],
        ['4', 'चौथा कार्यक्रम', 'नमूना', '5 मिनट', ''],
      ],
      total: 'कुल समय: 20 मिनट',
      borders: 'none',
      mergedAlign: 'middle',
    }),
  ],
  status: 'read',
  lang: 'hi',
  title: 'नमूना कार्यक्रम',
  total: 'कुल समय: 20 मिनट',
  items: [
    ['1', 'पहला कार्यक्रम', 'नमूना विवरण', '5 मिनट', 'वक्ता एक'],
    ['2', 'दूसरा कार्यक्रम', 'नमूना', '10 मिनट', 'वक्ता दो'],
    ['3', 'तीसरा कार्यक्रम', 'नमूना', '10 मिनट', 'वक्ता तीन'],
    ['4', 'चौथा कार्यक्रम', 'नमूना', '5 मिनट', ''],
  ],
};

/** A numbered list with no table: each number its item, a wrapped line kept with the item above it, the total. */
export const LIST: FlowFixture = {
  fileName: 'Flowcheck numbered list.pdf',
  pages: [
    flowListPage({
      title: 'Flowcheck list',
      lines: [
        '1. Flowcheck opening',
        '2. Flowcheck second item',
        '   continued on a second line',
        '3. Flowcheck third item',
      ],
      total: 'Total: 45 min',
    }),
  ],
  status: 'read',
  lang: 'en',
  title: 'Flowcheck list',
  total: 'Total: 45 min',
  items: [
    ['1', 'Flowcheck opening'],
    ['2', 'Flowcheck second item continued on a second line'],
    ['3', 'Flowcheck third item'],
  ],
};

/** A scan: a page that is only a picture, with no text layer. */
export const SCAN: FlowFixture = {
  fileName: 'Flowcheck scanned order.pdf',
  pages: [flowScanPage()],
  status: 'no-text',
  lang: 'mixed',
  items: [],
};

/** Gujarati words in fonts with no real Unicode map (each glyph read back as a private-use character). */
export const UNREADABLE: FlowFixture = {
  fileName: 'Flowcheck unreadable order.pdf',
  pages: [
    flowTablePage({
      headers: ['ક્રમ', 'કાર્યક્રમ', 'વિગત'],
      widths: [44, 180, 180],
      rows: [
        ['૧', 'પહેલો કાર્યક્રમ', 'નમૂનો'],
        ['૨', 'બીજો કાર્યક્રમ', 'નમૂનો'],
      ],
    }),
  ],
  options: { mapping: 'private-use' },
  status: 'unreadable',
  lang: 'mixed',
  items: [],
};

/** Readable words, but no numbered item among them. */
export const NO_ITEMS: FlowFixture = {
  fileName: 'Flowcheck notice.pdf',
  pages: [
    flowListPage({ title: 'Flowcheck notice', lines: ['Placeholder words only', 'More placeholder words'] }),
  ],
  status: 'no-items',
  lang: 'en',
  items: [],
};

/** What the panel and a phone say for a PDF they could not read (sabha-flow-lines.ts's statusWords), in part. */
export const STATUS_PHRASE: Record<Exclude<SabhaFlowStatus, 'read'>, string> = {
  'no-text': 'no words Drashti can read',
  unreadable: 'couldn’t read this PDF’s words',
  'no-items': 'no numbered items',
};

/** Each fixture written to a new folder of its own: its file's path. */
export async function writeFlows<K extends string>(
  fixtures: Record<K, FlowFixture>,
): Promise<Record<K, string>> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-flow-scenarios-'));
  const out = {} as Record<K, string>;
  for (const key of Object.keys(fixtures) as K[]) {
    const f = fixtures[key];
    const file = join(dir, f.fileName);
    writeFileSync(file, await makeFlowPdf(f.pages, f.options));
    out[key] = file;
  }
  return out;
}

const SEP = ' · ';
const said = (parts: readonly string[]) => parts.filter((p) => p.trim() !== '').join(SEP);

/** An item as the read list shows it: "1 · Program · Details · Duration · Presenter", empty cells left out. */
export const lineOf = (item: readonly string[]): string => said(item);
/** Now, marked on an item: its number and first two cells. */
export const nowOf = (item: readonly string[]): string => `Now: ${said(item.slice(0, 3))}`;
export const NOW_NOT_STARTED = 'Now: not started';
/** Next up: the item in full. */
export const nextOf = (item: readonly string[]): string => `Next up: ${lineOf(item)}`;
export const LAST_ITEM = 'Last item';

/** The nth item of a fixture (from 0), which must be there. */
export function itemOf(f: FlowFixture, n: number): string[] {
  const item = f.items[n];
  if (!item) throw new Error(`${f.fileName} has no item ${String(n + 1)}`);
  return item;
}
