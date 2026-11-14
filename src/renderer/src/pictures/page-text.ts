import { MAX_PAGE_TEXT } from '../../../shared/pictures';

/*
 * A page's words, read in the hidden pictures window (Session 57, C15): the words of a Keynote PDF's page, matched in
 * the import against its PowerPoint copy's slides (main/import/pictures.ts, keynotePagesShifted).
 */

/** What reading a page's words needs of pdf.js's page: its text, item by item. */
export interface TextPage {
  streamTextContent(): ReadableStream;
}

/** A small complete sample, without making text extraction a condition for drawing a page. */
export async function pageTextOf(page: TextPage): Promise<string | undefined> {
  type TextReader = ReadableStreamDefaultReader<{ items: { str?: string }[] }>;
  let reader: TextReader | undefined;
  try {
    reader = page.streamTextContent().getReader() as TextReader;
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
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
    reader?.releaseLock();
  }
}
