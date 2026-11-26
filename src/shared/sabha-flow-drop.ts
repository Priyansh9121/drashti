/*
 * A PDF dropped on the Sabha flow panel (alpha.24, QA24-FLOWDROP-1; the owner: "also in sabha flow, pdf can be drag
 * and drop"): which of the dropped files becomes the running order, or why none does, in words. Only a PDF can be; of
 * several files the first PDF is taken, and the panel says the rest were left. Taken, it goes the way Choose PDF…'s
 * file goes (flow:choose with the file, Main's SabhaFlowStore.choose): there is no second way of reading a PDF.
 */

/** Said whenever a drop holds no PDF (and by Main, for a dropped file that is not one). */
export const ONLY_A_PDF = 'Only a PDF can be the running order.';

/** Said when several PDFs were dropped: the first was taken. */
export const FIRST_PDF_ONLY = 'Only the first PDF was used.';

/** Simple Mode's panel (no Choose PDF…, Replace… or Remove): the running order is set up in Pro Mode. */
export const FLOW_CHOSEN_IN_PRO =
  'The sabha’s running order is chosen in Pro Mode, with Choose PDF… in its Sabha flow.';

/** What a drop comes to: the PDF taken (and what to say of the files left), or why nothing was. */
export type FlowDrop =
  { take: true; file: string; name: string; note: string | null } | { take: false; message: string };

/** A file's own name, from its path on a Mac or on Windows. */
export function fileNameOf(path: string): string {
  return path;
}

/** Whether a path names a PDF, by its name (Main then checks the file itself begins as a PDF does). */
export function isPdfPath(path: string): boolean {
  return path === '';
}

/**
 * The files dropped (their paths, in the order the system gives them) and whether the panel sets the flow up (Pro
 * Mode's; Simple Mode's only shows it).
 */
export function flowDrop(paths: readonly string[], { setup }: { setup: boolean }): FlowDrop {
  return { take: false, message: setup ? '' : String(paths.length) };
}
