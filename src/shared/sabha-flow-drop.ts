/*
 * A PDF dropped on the Sabha flow panel (alpha.24, QA24-FLOWDROP-1; the owner: "also in sabha flow, pdf can be drag
 * and drop"): which of the dropped files becomes the running order, or why none does, in words. Only a PDF can be; of
 * several files the first PDF is taken, and the panel says the rest were left. Taken, it goes the way Choose PDF…'s
 * file goes (flow:choose with the file, Main's SabhaFlowStore.choose): there is no second way of reading a PDF.
 *
 * The panel takes only a drop that holds a PDF, in Pro Mode (panelTakes). Anything else dropped on it goes by to the
 * window's import of files dropped anywhere on it (operator/App.tsx; Simple Mode's into its playlist, simple/
 * SimpleApp.tsx), as before the panel took drops (bughunt S2-1: it took every drop, so a video landing there was no
 * longer imported).
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
  return path.split(/[\\/]/).pop() ?? '';
}

/** Whether a path names a PDF, by its name (Main then checks the file itself begins as a PDF does). */
export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(fileNameOf(path));
}

/** A PDF's kind, as the system says a dragged file's (from its name). */
const PDF_TYPE = 'application/pdf';

/**
 * Whether the panel takes files dragged over it or dropped on it, or lets them go by to the window's import (bughunt
 * S2-1): in Pro Mode, only those with a PDF among them. While the drag is under way only the files' kinds can be read
 * (`types`); at the drop their names say (`paths`), and a PDF whose place Drashti cannot tell (no path: dragged from
 * somewhere that is not a folder) stays the panel's, which says so. Simple Mode's panel takes none.
 */
export function panelTakes(
  files: { types: readonly string[]; paths?: readonly string[] },
  { setup }: { setup: boolean },
): boolean {
  if (!setup) return false;
  if (files.paths !== undefined && files.paths.length > 0) return files.paths.some(isPdfPath);
  return files.types.includes(PDF_TYPE);
}

/**
 * The files dropped (their paths, in the order the system gives them) and whether the panel sets the flow up (Pro
 * Mode's; Simple Mode's only shows it).
 */
export function flowDrop(paths: readonly string[], { setup }: { setup: boolean }): FlowDrop {
  if (!setup) return { take: false, message: FLOW_CHOSEN_IN_PRO };
  if (paths.length === 0)
    return {
      take: false,
      message: 'Drop the PDF from the desktop or a USB drive: Drashti can’t tell where that one is kept.',
    };
  const pdfs = paths.filter(isPdfPath);
  const file = pdfs[0];
  if (!file)
    return {
      take: false,
      message:
        paths.length === 1
          ? `“${fileNameOf(paths[0] ?? '')}” is not a PDF, so it was not used. ${ONLY_A_PDF}`
          : `${paths.length} files were not used: none of them is a PDF. ${ONLY_A_PDF}`,
    };
  const others = paths.length - 1;
  const note =
    pdfs.length > 1
      ? FIRST_PDF_ONLY
      : others === 0
        ? null
        : others === 1
          ? 'Only the PDF was used: the other file is not a PDF.'
          : `Only the PDF was used: the other ${others} files are not PDFs.`;
  return { take: true, file, name: fileNameOf(file), note };
}
