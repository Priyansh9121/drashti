import { MAX_PAGE_TEXT } from '../../../shared/pictures';

/*
 * A page's words, read in the hidden pictures window (Session 57, C15): the words of a Keynote PDF's page, matched in
 * the import against its PowerPoint copy's slides (main/import/pictures.ts, keynotePagesShifted).
 */

/** What reading a page's words needs of pdf.js's page: its text, item by item. */
export interface TextPage {
  streamTextContent(): ReadableStream;
}

/**
 * How long a page's words may take (C15's review, L5): the same pdf.js has just drawn the page, so they come in a few
 * milliseconds; one whose words never came would hold the window, and the whole drawing, up to its 15-minute limit.
 */
export const PAGE_TEXT_MS = 2000;

/**
 * A small complete sample, without making text extraction a condition for drawing a page: none past 4,096
 * characters, none after 2 s.
 */
export async function pageTextOf(page: TextPage): Promise<string | undefined> {
  type TextReader = ReadableStreamDefaultReader<{ items: { str?: string }[] }>;
  let reader: TextReader | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => {
      resolve('late');
    }, PAGE_TEXT_MS);
  });
  try {
    reader = page.streamTextContent().getReader() as TextReader;
    let text = '';
    for (;;) {
      const next = await Promise.race([reader.read(), late]);
      if (next === 'late') {
        // Stopped, not waited on: pdf.js's own stopping is no reason to wait either.
        void reader.cancel().catch(() => undefined);
        return undefined;
      }
      const { done, value } = next;
      if (done) return text;
      for (const { str } of value.items) {
        if (!str) continue;
        if (text.length + str.length + 1 > MAX_PAGE_TEXT) {
          await reader.cancel();
          return undefined;
        }
        text += str + ' ';
      }
    }
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    reader?.releaseLock();
  }
}
