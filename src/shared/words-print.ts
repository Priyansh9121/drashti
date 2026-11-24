import type { ManualPrinted } from './manual';
import { savedWhere } from './manual';

/*
 * A singers' sheet (alpha.22): Print words… and Save words as PDF… of a presentation, in the library's right-click
 * menu (Pro Mode). The page is made and printed in the main process (src/main/words-print.ts), from the Manual's hidden
 * window, one print at a time; never while the show is live, by the Manual's rule (the lead's call of 20 Nov 2026).
 */

/** How Print words… or Save words as PDF… went: done (where to, for a PDF), left (the person cancelled), or why not. */
export type WordsPrinted = ManualPrinted;

/** The main process's answer to a request while anything is up, or the stream is on air or recording. */
export const WORDS_PRINT_REFUSED =
  'Print or save the words when nothing is up, on air or recording: clear what is up, and end the stream and the recording first.';

/** What the operator is told after Print words… or Save words as PDF…: null when the person cancelled. */
export function wordsPrintedText(name: string, result: WordsPrinted): string | null {
  if (result.ok)
    return result.file
      ? `Saved the words of “${name}” as a PDF: ${savedWhere(result.file)}.`
      : `The words of “${name}” went to the printer.`;
  return result.cancelled ? null : result.message;
}
