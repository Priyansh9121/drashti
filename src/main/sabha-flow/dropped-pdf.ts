import { isAbsolute } from 'node:path';

/*
 * A PDF dropped on the operator window's Sabha flow panel (alpha.24, QA24-FLOWDROP-1), as flow:choose is handed it:
 * its full path on this computer, or null for anything else. Main then takes it as it takes Choose PDF…'s file
 * (SabhaFlowStore.choose: a file, not too big, that begins as a PDF does): no second way of reading a PDF.
 */

/** The path, when it is a full path on this computer to a file named as a PDF; null for anything else. */
export function droppedPdf(raw: unknown): string | null {
  return typeof raw === 'string' &&
    raw.length <= 32767 &&
    !raw.includes('\0') &&
    isAbsolute(raw) &&
    /\.pdf$/i.test(raw)
    ? raw
    : null;
}
