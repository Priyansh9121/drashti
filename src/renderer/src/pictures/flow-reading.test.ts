import { describe, expect, it } from 'vitest';
import { flowPageSafely, readFlowSafely, type FlowPdfPage } from './flow-reading';

/*
 * Sabha flow (alpha.23): in the pictures window, each page's text layer is read after its picture is made, and the
 * flow is read from all of them once the pages are drawn (never in Main). Neither may cost the page's picture or end
 * in anything but a plain status (review M1, S4).
 */

const ops = { constructPath: 91, fill: 22, stroke: 20, save: 10, restore: 11, transform: 12 };
const viewport = { width: 595, height: 842, transform: [1, 0, 0, -1, 0, 842] };

function page(over: Partial<FlowPdfPage> = {}): FlowPdfPage {
  return {
    getViewport: () => viewport,
    getTextContent: () =>
      Promise.resolve({ items: [{ str: 'Placeholder', transform: [10, 0, 0, 10, 40, 742], width: 50 }] }),
    getOperatorList: () => Promise.resolve({ fnArray: [], argsArray: [] }),
    ...over,
  };
}

describe('the pictures window’s Sabha flow reading', () => {
  it('reads a page’s text layer and borders, asking pdf.js for the list the drawing made (print)', async () => {
    const asked: unknown[] = [];
    const read = await flowPageSafely(
      page({
        getOperatorList: (params) => {
          asked.push(params);
          return Promise.resolve({ fnArray: [], argsArray: [] });
        },
      }),
      ops,
    );
    expect(read).toEqual({
      width: 595,
      height: 842,
      texts: [{ s: 'Placeholder', x: 40, y: 100, w: 50, h: 10 }],
      rules: [],
    });
    expect(asked).toEqual([expect.objectContaining({ intent: 'print' })]);
  });

  it('a page whose text layer cannot be read gives none (S4): its picture still goes', async () => {
    expect(
      await flowPageSafely(page({ getTextContent: () => Promise.reject(new Error('placeholder')) }), ops),
    ).toBeNull();
    expect(
      await flowPageSafely(page({ getOperatorList: () => Promise.reject(new Error('placeholder')) }), ops),
    ).toBeNull();
  });

  it('reads the flow from the pages; a reader that fails gives none (Main says why and shows it unreadable), never a throw', () => {
    expect(readFlowSafely([])).toEqual({ status: 'no-text', lang: 'mixed', headers: [], items: [] });
    expect(
      readFlowSafely([], () => {
        throw new RangeError('placeholder');
      }),
    ).toBeNull();
  });
});
