import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as PdfJs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { flowRulesOf, flowTextsOf, type FlowTextPage } from '../../shared/sabha-flow-text';
import { nodePdfAssets } from '../import/testing/pdfjs-assets';
import { readSabhaFlow } from './sabha-flow-reader';
import {
  flowListPage,
  flowScanPage,
  flowTablePage,
  flowTablePages,
  makeFlowPdf,
  type FlowPdfOptions,
  type FlowPdfPage,
} from './testing/sabha-flow-pdfs';

/*
 * Sabha flow (alpha.23): the reader, over placeholder PDFs made here (pdf-lib, the bundled Noto fonts) and read by the
 * app's own pdf.js (its Node build), as the pictures window reads them: the text layer and the borders, then the rows.
 */

let pdfjs: typeof PdfJs;
let workerBefore: PropertyDescriptor | undefined;
const require = createRequire(import.meta.url);
const localAssets = dirname(require.resolve('pdfjs-dist/package.json'));

beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  workerBefore = Object.getOwnPropertyDescriptor(globalThis, 'pdfjsWorker');
  Object.defineProperty(globalThis, 'pdfjsWorker', { configurable: true, writable: true, value: worker });
});
afterAll(() => {
  if (workerBefore) Object.defineProperty(globalThis, 'pdfjsWorker', workerBefore);
  else Reflect.deleteProperty(globalThis, 'pdfjsWorker');
});

/** The pages as the pictures window hands them to Main: pdf.js's text and operator list, at scale 1. */
async function pagesOf(bytes: Uint8Array): Promise<FlowTextPage[]> {
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    useSystemFonts: false,
    disableFontFace: true,
    ...nodePdfAssets(localAssets),
  });
  try {
    const doc = await loading.promise;
    const pages: FlowTextPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({
        width: viewport.width,
        height: viewport.height,
        texts: flowTextsOf(await page.getTextContent(), viewport),
        rules: flowRulesOf(await page.getOperatorList(), pdfjs.OPS, viewport),
      });
    }
    return pages;
  } finally {
    await loading.destroy();
  }
}

async function read(pages: FlowPdfPage[], options?: FlowPdfOptions) {
  return readSabhaFlow(await pagesOf(await makeFlowPdf(pages, options)));
}

const FIVE = [44, 140, 190, 70, 106];

describe('Sabha flow reader: tables', () => {
  it('reads an English table: header, numbered rows, wrapped details, merged cells on every row, total', async () => {
    const flow = await read([
      flowTablePage({
        title: 'Placeholder running order',
        subtitle: 'Sample hall, sample evening',
        headers: ['No.', 'Program', 'Details', 'Duration', 'Presenter'],
        widths: FIVE,
        rows: [
          ['1', 'Opening item', 'Placeholder details one', '5 min', 'Presenter A'],
          [
            '2',
            'Second item',
            'Placeholder details two\nwith a second line',
            { text: '10 min', rows: 2 },
            'Presenter B',
          ],
          ['3', 'Third item', 'Details three', null, 'Presenter C'],
          ['4', 'Fourth item', 'Details four', '15 min', { text: 'Presenter D', rows: 3 }],
          ['5', 'Video', 'Placeholder video', '8 min', null],
          ['6', 'Sixth item', 'Details six', '7 min', null],
          ['7', 'Seventh item', 'Details seven', '5 min', ''],
        ],
        total: 'Total duration: 60 min',
        borders: 'lines',
      }),
    ]);
    expect(flow).toEqual({
      status: 'read',
      lang: 'en',
      title: 'Placeholder running order',
      subtitle: 'Sample hall, sample evening',
      headers: ['No.', 'Program', 'Details', 'Duration', 'Presenter'],
      items: [
        { no: '1', cells: ['Opening item', 'Placeholder details one', '5 min', 'Presenter A'] },
        {
          no: '2',
          cells: ['Second item', 'Placeholder details two with a second line', '10 min', 'Presenter B'],
        },
        { no: '3', cells: ['Third item', 'Details three', '10 min', 'Presenter C'] },
        { no: '4', cells: ['Fourth item', 'Details four', '15 min', 'Presenter D'] },
        { no: '5', cells: ['Video', 'Placeholder video', '8 min', 'Presenter D'] },
        { no: '6', cells: ['Sixth item', 'Details six', '7 min', 'Presenter D'] },
        // An empty cell with its own borders is empty: only a merged one repeats.
        { no: '7', cells: ['Seventh item', 'Details seven', '5 min', ''] },
      ],
      total: 'Total duration: 60 min',
    });
  });

  it('reads a Gujarati table drawn with filled borders, Gujarati numbers, merged cells in their middle', async () => {
    const flow = await read([
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
    ]);
    expect(flow).toEqual({
      status: 'read',
      lang: 'gu',
      title: 'નમૂનો કાર્યક્રમ',
      subtitle: 'નમૂનો સભા',
      headers: ['ક્રમ', 'કાર્યક્રમ', 'વિગત', 'સમય', 'વક્તા'],
      items: [
        { no: '૧', cells: ['પહેલો કાર્યક્રમ', 'નમૂનો વિગત', '૫ મિનિટ', 'વક્તા એક'] },
        { no: '૨', cells: ['બીજો કાર્યક્રમ', 'નમૂનો', '૧૦ મિનિટ', 'વક્તા બે'] },
        { no: '૩', cells: ['ત્રીજો કાર્યક્રમ', 'નમૂનો', '૧૦ મિનિટ', 'વક્તા ત્રણ'] },
        { no: '૪', cells: ['ચોથો કાર્યક્રમ', 'નમૂનો', '૧૦ મિનિટ', 'વક્તા ચાર'] },
        { no: '૫', cells: ['પાંચમો કાર્યક્રમ', 'નમૂનો', '૫ મિનિટ', 'વક્તા ચાર'] },
      ],
      total: 'કુલ સમય: ૩૦ મિનિટ',
    });
  });

  it('reads a Hindi table with no borders: a merged cell in its middle covers the rows it sits across', async () => {
    const flow = await read([
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
    ]);
    expect(flow).toEqual({
      status: 'read',
      lang: 'hi',
      title: 'नमूना कार्यक्रम',
      headers: ['क्रम', 'कार्यक्रम', 'विवरण', 'समय', 'वक्ता'],
      items: [
        { no: '1', cells: ['पहला कार्यक्रम', 'नमूना विवरण', '5 मिनट', 'वक्ता एक'] },
        { no: '2', cells: ['दूसरा कार्यक्रम', 'नमूना', '10 मिनट', 'वक्ता दो'] },
        { no: '3', cells: ['तीसरा कार्यक्रम', 'नमूना', '10 मिनट', 'वक्ता तीन'] },
        { no: '4', cells: ['चौथा कार्यक्रम', 'नमूना', '5 मिनट', ''] },
      ],
      total: 'कुल समय: 20 मिनट',
    });
  });

  it('puts a short i written before its consonant (the order it is seen in) back after it', async () => {
    const flow = await read(
      [
        flowTablePage({
          headers: ['ક્રમ', 'કાર્યક્રમ', 'વિગત'],
          widths: [44, 180, 180],
          rows: [
            ['૧', 'પહેલો', 'વિગત'],
            ['૨', 'બીજો', 'નમૂનો વિગત'],
          ],
        }),
      ],
      { shortIFirst: true },
    );
    expect(flow.headers).toEqual(['ક્રમ', 'કાર્યક્રમ', 'વિગત']);
    expect(flow.items).toEqual([
      { no: '૧', cells: ['પહેલો', 'વિગત'] },
      { no: '૨', cells: ['બીજો', 'નમૂનો વિગત'] },
    ]);
  });
});

describe('Sabha flow reader: tables as word processors draw them', () => {
  it('reads borders drawn cell by cell, a header over two lines, numbers in the middle of tall rows, "1." numbers', async () => {
    const flow = await read([
      flowTablePage({
        title: 'Placeholder running order',
        headers: ['Sr.\nNo.', 'Program', 'Details', 'Planned\ntime', 'Presenter'],
        widths: FIVE,
        rows: [
          ['1.', 'Opening item', 'Placeholder details\nover two lines\nand a third', '5 min', 'Presenter A'],
          ['2.', 'Second item', 'Details two', { text: '10 min', rows: 2 }, 'Presenter B'],
          ['3.', 'Third item', 'Placeholder details\nover two lines', null, 'Presenter C'],
        ],
        total: 'Total: 15 min',
        borders: 'boxes',
        uprights: 'per-cell',
        numberAlign: 'middle',
      }),
    ]);
    expect(flow).toEqual({
      status: 'read',
      lang: 'en',
      title: 'Placeholder running order',
      headers: ['Sr. No.', 'Program', 'Details', 'Planned time', 'Presenter'],
      items: [
        {
          no: '1',
          cells: ['Opening item', 'Placeholder details over two lines and a third', '5 min', 'Presenter A'],
        },
        { no: '2', cells: ['Second item', 'Details two', '10 min', 'Presenter B'] },
        { no: '3', cells: ['Third item', 'Placeholder details over two lines', '10 min', 'Presenter C'] },
      ],
      total: 'Total: 15 min',
    });
  });

  it('reads a table over two pages, its header row repeated on the second', async () => {
    const flow = await read(
      flowTablePages({
        title: 'Placeholder running order',
        headers: ['No.', 'Program', 'Details', 'Duration', 'Presenter'],
        widths: FIVE,
        rows: [
          ['1', 'Opening item', 'Details one', '5 min', 'Presenter A'],
          ['2', 'Second item', 'Details two', '5 min', 'Presenter B'],
          ['3', 'Third item', 'Details three', '5 min', 'Presenter C'],
          ['4', 'Fourth item', 'Details four', '5 min', 'Presenter D'],
        ],
        rowsPerPage: 2,
        total: 'Total: 20 min',
        borders: 'lines',
      }),
    );
    expect(flow).toEqual({
      status: 'read',
      lang: 'en',
      title: 'Placeholder running order',
      headers: ['No.', 'Program', 'Details', 'Duration', 'Presenter'],
      items: [
        { no: '1', cells: ['Opening item', 'Details one', '5 min', 'Presenter A'] },
        { no: '2', cells: ['Second item', 'Details two', '5 min', 'Presenter B'] },
        { no: '3', cells: ['Third item', 'Details three', '5 min', 'Presenter C'] },
        { no: '4', cells: ['Fourth item', 'Details four', '5 min', 'Presenter D'] },
      ],
      total: 'Total: 20 min',
    });
  });
});

describe('Sabha flow reader: a numbered list, and what cannot be read', () => {
  it('reads a numbered list (no table): each number its item, a wrapped line kept with it, the total', async () => {
    const flow = await read([
      flowListPage({
        title: 'Placeholder order',
        lines: [
          '1. Placeholder opening',
          '2. Placeholder second item',
          '   continued on a second line',
          '3. Placeholder third item',
        ],
        total: 'Total: 45 min',
      }),
    ]);
    expect(flow).toEqual({
      status: 'read',
      lang: 'en',
      title: 'Placeholder order',
      headers: [],
      items: [
        { no: '1', cells: ['Placeholder opening'] },
        { no: '2', cells: ['Placeholder second item continued on a second line'] },
        { no: '3', cells: ['Placeholder third item'] },
      ],
      total: 'Total: 45 min',
    });
  });

  it("says 'no-text' for a scan (a picture, no text layer)", async () => {
    const flow = await read([flowScanPage()]);
    expect(flow).toEqual({ status: 'no-text', lang: 'mixed', headers: [], items: [] });
  });

  it("says 'unreadable' when the text maps to private-use characters (a font with no Unicode map)", async () => {
    const page = flowTablePage({
      headers: ['ક્રમ', 'કાર્યક્રમ', 'વિગત'],
      widths: [44, 180, 180],
      rows: [
        ['૧', 'પહેલો કાર્યક્રમ', 'નમૂનો'],
        ['૨', 'બીજો કાર્યક્રમ', 'નમૂનો'],
      ],
    });
    const flow = await read([page], { mapping: 'private-use' });
    expect(flow).toEqual({ status: 'unreadable', lang: 'mixed', headers: [], items: [] });
  });

  it("says 'no-items' for readable text with no numbered items", async () => {
    const flow = await read([
      flowListPage({
        title: 'Placeholder notice',
        lines: ['Placeholder words only', 'More placeholder words'],
      }),
    ]);
    expect(flow).toEqual({ status: 'no-items', lang: 'en', headers: [], items: [] });
  });
});

/** A page of runs placed by hand (no PDF): for what pdf.js could hand over but no placeholder PDF needs to show. */
const handPage = (texts: FlowTextPage['texts'], rules: FlowTextPage['rules'] = []): FlowTextPage => ({
  width: 595,
  height: 842,
  texts,
  rules,
});
const run = (s: string, x: number, y: number, h = 10) => ({ s, x, y, w: s.length * 0.5 * h, h });

/** A small placeholder table placed by hand: No. | Program | Duration, rows 1 to `rows`. */
function handTable(rows: number): FlowTextPage {
  const texts = [run('No.', 40, 100), run('Program', 90, 100), run('Duration', 260, 100)];
  for (let r = 1; r <= rows; r++)
    texts.push(
      run(String(r), 40, 100 + 20 * r),
      run(`Item ${String(r)}`, 90, 100 + 20 * r),
      run('5 min', 260, 100 + 20 * r),
    );
  return { width: 595, height: Math.max(842, 140 + 20 * rows), texts, rules: [] };
}

/** Runs of placeholder filler on a page of their own, `count` of them, `length` characters each. */
const filler = (count: number, length = 1) =>
  handPage(
    Array.from({ length: count }, (_, k) =>
      run('x'.repeat(length), 40 + (k % 40) * 12, 20 + Math.floor(k / 40) * 2, 1),
    ),
  );

describe('Sabha flow reader: what it takes in is bounded (review M1; it runs in the pictures window, never Main)', () => {
  it('a table among more than 12,000 runs of text in all is no running order (no-items); with a few more it reads', () => {
    expect(readSabhaFlow([handTable(3), filler(100)]).status).toBe('read');
    expect(readSabhaFlow([handTable(3), filler(12_000)])).toEqual({
      status: 'no-items',
      lang: 'en',
      headers: [],
      items: [],
    });
  });

  it('a table among more than 200,000 characters in all is no running order (no-items)', () => {
    expect(readSabhaFlow([handTable(3), filler(120, 2000)]).status).toBe('no-items');
  });

  it('more than 2,000 numbered lines are no running order (no-items)', () => {
    expect(readSabhaFlow([handTable(200)]).status).toBe('read');
    expect(readSabhaFlow([handTable(2100)]).status).toBe('no-items');
  });
});

describe('Sabha flow reader: what the review found (S1, S2, S3, nits)', () => {
  it("S1: says 'unreadable' for an old typing font's text that comes out as plain ASCII", async () => {
    const flow = await read([
      flowTablePage({
        title: 'uewuk dk;Zdze',
        headers: ['dze', 'dk;Zdze', 'fooj.k', 'le;', 'oDrk'],
        widths: FIVE,
        rows: [
          ['1', 'izFke dk;Zdze', 'uewuk fooj.k', '5 feuV', 'oDrk ,d'],
          ['2', 'f}rh; dk;Zdze', 'uewuk', '10 feuV', 'oDrk nks'],
          ['3', 'r`rh; dk;Zdze', 'uewuk', '5 feuV', 'oDrk rhu'],
        ],
        total: 'dqy le;% 20 feuV',
      }),
    ]);
    expect(flow).toEqual({ status: 'unreadable', lang: 'mixed', headers: [], items: [] });
  });

  it('S1: plain English with names like McDonald, iPad and Q&A stays read', async () => {
    const flow = await read([
      flowTablePage({
        headers: ['No.', 'Program', 'Details', 'Duration', 'Presenter'],
        widths: FIVE,
        rows: [
          ['1', 'Opening item', 'Placeholder Q&A', '5 min', 'Presenter McDonald'],
          ['2', 'Second item', 'Placeholder iPad slides', '10 min', 'Presenter DeVries'],
          ['3', 'Third item', 'Placeholder details', '5 min', 'Mr Placeholder'],
        ],
      }),
    ]);
    expect(flow).toMatchObject({ status: 'read', lang: 'en' });
    expect(flow.items.map((i) => i.cells[3])).toEqual([
      'Presenter McDonald',
      'Presenter DeVries',
      'Mr Placeholder',
    ]);
  });

  it('S2: a lone number in the subtitle, standing over the numbers, is not where the rows start', async () => {
    const page = flowTablePage({
      title: 'Placeholder running order',
      subtitle: 'nd placeholder evening',
      headers: ['No.', 'Program', 'Details'],
      widths: [44, 200, 200],
      rows: [1, 2, 3, 4, 5].map((n) => [String(n), `Item ${String(n)}`, 'Placeholder']),
    });
    // As a word processor writes "2nd": the number a run of its own, the "nd" smaller beside it.
    const subtitle = page.texts.find((t) => t.text === 'nd placeholder evening');
    if (!subtitle) throw new Error('no subtitle');
    page.texts.push({ text: '2', x: subtitle.x + 4, y: subtitle.y, size: subtitle.size });
    subtitle.x += 14;
    subtitle.size *= 0.7;
    const flow = await read([page]);
    expect(flow.items.map((i) => i.no)).toEqual(['1', '2', '3', '4', '5']);
    expect(flow.headers).toEqual(['No.', 'Program', 'Details']);
  });

  it("S3: 'total' only as a whole word: a row's 'totally' is its words, a clock time under the table no total", async () => {
    const flow = await read([
      flowTablePage({
        headers: ['No.', 'Program', 'Details'],
        widths: [44, 200, 200],
        rows: [
          ['1', 'Item one', 'Placeholder'],
          ['2', 'Item two', 'Placeholder details\ntotally placeholder'],
        ],
        borders: 'none',
      }),
    ]);
    expect(flow.items[1]).toEqual({
      no: '2',
      cells: ['Item two', 'Placeholder details totally placeholder'],
    });
    const below = flowListPage({
      lines: ['1. Placeholder opening', '2. Placeholder second', 'Doors open 7:30'],
    });
    expect((await read([below])).total).toBeUndefined();
  });

  it('nit: a time (3:30) is not an item number', async () => {
    const flow = await read([
      flowListPage({ lines: ['1. Placeholder opening', '2. Placeholder second', '3:30 placeholder break'] }),
    ]);
    expect(flow.items).toEqual([
      { no: '1', cells: ['Placeholder opening'] },
      { no: '2', cells: ['Placeholder second'] },
    ]);
  });

  it("nit: a scan with a few words on it (a page number, a watermark) is 'no-text'", () => {
    expect(readSabhaFlow([handPage([run('p. 1', 290, 820), run('Scan', 40, 20)])])).toEqual({
      status: 'no-text',
      lang: 'mixed',
      headers: [],
      items: [],
    });
  });

  it('nit: a private-use or replacement character in a readable flow is left out of its words', () => {
    const flow = readSabhaFlow([
      handPage([
        run('No.', 40, 100),
        run('Program', 90, 100),
        run('Details', 260, 100),
        run('1', 40, 120),
        run('Item one', 90, 120),
        run('Placeholder�', 260, 120),
        run('2', 40, 140),
        run('Item two', 90, 140),
        run('Placeholder', 260, 140),
      ]),
    ]);
    expect(flow.items).toEqual([
      { no: '1', cells: ['Item one', 'Placeholder'] },
      { no: '2', cells: ['Item two', 'Placeholder'] },
    ]);
  });

  it('a table shaped like a word processor running order: an empty number header, a block merged over 3 rows', async () => {
    const flow = await read([
      flowTablePage({
        title: 'Placeholder running order',
        subtitle: 'Placeholder evening',
        headers: ['', 'Program', 'Details', 'Duration', 'Presenter'],
        widths: [30, 90, 240, 70, 100],
        rows: [
          ['1', 'Item one', 'Placeholder one', '5 min', ''],
          [
            '2',
            'Item two',
            { text: '', rows: 3 },
            { text: '10 min', rows: 3 },
            { text: 'Presenter A', rows: 3 },
          ],
          ['3', 'Item three', null, null, null],
          ['4', 'Item four', null, null, null],
          ['5', 'Item five', 'Placeholder five', '5 min', ''],
          ['6', '', 'Placeholder six', '5 min', 'Presenter B'],
        ],
        total: 'Total: 25 min',
        borders: 'boxes',
        uprights: 'per-cell',
      }),
    ]);
    expect(flow).toEqual({
      status: 'read',
      lang: 'en',
      title: 'Placeholder running order',
      subtitle: 'Placeholder evening',
      headers: ['', 'Program', 'Details', 'Duration', 'Presenter'],
      items: [
        { no: '1', cells: ['Item one', 'Placeholder one', '5 min', ''] },
        { no: '2', cells: ['Item two', '', '10 min', 'Presenter A'] },
        { no: '3', cells: ['Item three', '', '10 min', 'Presenter A'] },
        { no: '4', cells: ['Item four', '', '10 min', 'Presenter A'] },
        { no: '5', cells: ['Item five', 'Placeholder five', '5 min', ''] },
        { no: '6', cells: ['', 'Placeholder six', '5 min', 'Presenter B'] },
      ],
      total: 'Total: 25 min',
    });
  });
});
