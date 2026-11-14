import { afterEach, expect, it, vi } from 'vitest';
import { MAX_PAGE_TEXT } from '../../../shared/pictures';
import { pageTextOf, type TextPage } from './page-text';

/*
 * A page's words, read as the hidden pictures window draws a Keynote PDF (Session 57, C15): never a condition for
 * drawing the page. A page whose words do not come within 2 s has none (C15's review, L5): the window never waits on
 * them, up to the drawing's 15-minute limit.
 */

/** A page whose words come in these chunks, each a list of pdf.js's text items; `cancelled` once reading stops. */
function pageOf(chunks: readonly (readonly string[])[] | 'never' | 'fails') {
  const read = { cancelled: false };
  const page: TextPage = {
    streamTextContent: () =>
      new ReadableStream<{ items: { str: string }[] }>({
        start(controller) {
          if (chunks === 'fails') controller.error(new Error('Placeholder text stream error'));
          if (typeof chunks === 'string') return;
          for (const chunk of chunks) controller.enqueue({ items: chunk.map((str) => ({ str })) });
          controller.close();
        },
        cancel() {
          read.cancelled = true;
        },
      }),
  };
  return { page, read };
}

afterEach(() => {
  vi.useRealTimers();
});

it('reads a page’s words, item by item, leaving out empty items', async () => {
  const { page } = pageOf([['Placeholder', '', 'words'], ['again']]);
  expect(await pageTextOf(page)).toBe('Placeholder words again ');
});

it('gives no words beyond 4,096 characters, and stops reading', async () => {
  const { page, read } = pageOf([['Placeholder'], ['x'.repeat(MAX_PAGE_TEXT)], ['never read']]);
  expect(await pageTextOf(page)).toBeUndefined();
  expect(read.cancelled).toBe(true);
});

it('gives no words when reading them fails', async () => {
  expect(await pageTextOf(pageOf('fails').page)).toBeUndefined();
});

it('gives no words for a page whose words do not come within 2 s, and stops reading them', async () => {
  vi.useFakeTimers();
  const { page, read } = pageOf('never');
  const got: { settled: boolean; words?: string } = { settled: false };
  void pageTextOf(page).then((words) => {
    got.settled = true;
    got.words = words;
  });
  await vi.advanceTimersByTimeAsync(1_999);
  expect(got.settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(got.settled).toBe(true);
  expect(got.words).toBeUndefined();
  expect(read.cancelled).toBe(true);
});
