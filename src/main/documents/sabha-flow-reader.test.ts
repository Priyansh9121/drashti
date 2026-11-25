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
