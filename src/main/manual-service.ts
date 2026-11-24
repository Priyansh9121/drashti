import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MANUAL_CHAPTERS,
  MANUAL_PRINT_REFUSED,
  type ManualPrinted,
  type ManualRead,
  manualPictureName,
} from '../shared/manual';
import { parseMarkdown } from '../shared/markdown';
import type { GuideFiles } from './guides';
import {
  fileAddress,
  manualHtml,
  type PrintOutcome,
  printerBusy,
  printPage,
  takePrinter,
} from './manual-print';
import { fileProblem } from './plain-errors';

/*
 * The Drashti Manual's side in the main process (x37, Session 60): every chapter's text for the operator window (in
 * either mode: reading it changes nothing), and the whole manual printed, or saved as a PDF where the person chooses,
 * one at a time. Each is asked for by the operator window only (index.ts checks); nothing here touches the show.
 */

/** Every chapter's Markdown, with each picture's size; refused whole when a chapter's file is missing. */
export function readManual(files: GuideFiles): ManualRead {
  const chapters = MANUAL_CHAPTERS.map((c) => ({ id: c.id, text: files.readManual(c.id) }));
  if (chapters.some((c) => c.text === null))
    return { ok: false, message: 'The manual is missing from Drashti’s folder: install Drashti again.' };
  const read = chapters.map((c) => ({ id: c.id, text: c.text ?? '' }));
  return { ok: true, chapters: read, sizes: files.sizesFor(read.map((c) => c.text).join('\n\n')) };
}

/** The whole manual as one page to print, and the files of the pictures it shows (only those may load). */
export function manualPage(files: GuideFiles, version: string): { html: string; pictures: string[] } | null {
  const pictures: string[] = [];
  const picture = (src: string) => {
    const name = manualPictureName(src);
    const file = name ? files.picture(name) : null;
    if (!file) return null;
    pictures.push(file);
    return fileAddress(file);
  };
  const chapters = MANUAL_CHAPTERS.map((c) => {
    const text = files.readManual(c.id);
    return text === null ? null : { title: c.title, blocks: parseMarkdown(text) };
  });
  if (chapters.some((c) => c === null)) return null;
  const html = manualHtml({ chapters: chapters.filter((c) => c !== null), version, picture });
  return { html, pictures };
}

export interface ManualPrinterDeps {
  files: GuideFiles;
  version: () => string;
  /** Where the page to print is written for a moment (a folder of its own is made in it, and taken away after). */
  tempDir: () => string;
  /** The system's save dialog: the file chosen, or null when the person cancelled. `suggested` is the full path. */
  askWhere: (suggested: string) => Promise<string | null>;
  /** Where the save dialog suggests first (Documents). */
  suggestedFolder: () => string;
  /** Printing itself (manual-print.ts; a test's stand-in). */
  print?: typeof printPage;
  write?: (file: string, data: Buffer) => void;
  /**
   * Whether the show is live now (anything up, or the stream on air or recording: index.ts, as the work that waits
   * for an idle show asks): nothing is printed then (the lead's call of 20 Nov 2026).
   */
  live: () => boolean;
}

/** The PDF's name the save dialog suggests. */
export const MANUAL_PDF_NAME = 'Drashti Manual.pdf';

/** The manual's name for the printer, its page's title and its footer's words. */
const MANUAL = 'The manual';
const MANUAL_TITLE = 'Drashti Manual';
const MISSING: ManualPrinted = {
  ok: false,
  cancelled: false,
  message: 'The manual is missing from Drashti’s folder: install Drashti again.',
};

/**
 * Print… and Save as PDF…, one at a time (across the manual and every running order: manual-print.ts's
 * `takePrinter`), and only while the show is not live.
 */
export class ManualPrinter {
  constructor(private readonly deps: ManualPrinterDeps) {}

  /** Through the system's print dialog. */
  async print(): Promise<ManualPrinted> {
    return this.once(async () => {
      const made = await this.run('print');
      if (made === null) return MISSING;
      if (made.ok) return { ok: true, file: null };
      if (made.cancelled) return { ok: false, cancelled: true };
      return {
        ok: false,
        cancelled: false,
        message: 'The manual was not printed: check the printer is on and chosen, then press Print… again.',
      };
    });
  }

  /** Saved as a PDF where the person chooses. */
  async pdf(): Promise<ManualPrinted> {
    return this.once(async () => {
      const where = await this.deps.askWhere(join(this.deps.suggestedFolder(), MANUAL_PDF_NAME));
      if (where === null) return { ok: false, cancelled: true };
      const made = await this.run('pdf');
      if (made === null) return MISSING;
      if (!made.ok || made.pdf === null)
        return {
          ok: false,
          cancelled: false,
          message: 'The manual was not made into a PDF: press Save as PDF… again.',
        };
      try {
        (this.deps.write ?? writeFileSync)(where, made.pdf);
      } catch (error) {
        return { ok: false, cancelled: false, message: fileProblem(error, 'write') };
      }
      return { ok: true, file: where };
    });
  }

  private async once(run: () => Promise<ManualPrinted>): Promise<ManualPrinted> {
    // Nothing printed, and nothing asked, while the show is live (the window's buttons wait then too).
    if (this.deps.live()) return { ok: false, cancelled: false, message: MANUAL_PRINT_REFUSED };
    const printer = takePrinter(MANUAL);
    if ('heldBy' in printer) return { ok: false, cancelled: false, message: printerBusy(printer.heldBy) };
    try {
      return await run();
    } finally {
      printer.release();
    }
  }

  /** The page made and printed; null when a chapter's file is missing. */
  private async run(kind: 'pdf' | 'print'): Promise<PrintOutcome | null> {
    const page = manualPage(this.deps.files, this.deps.version());
    if (page === null) return null;
    try {
      return await (this.deps.print ?? printPage)({
        ...page,
        tempDir: this.deps.tempDir(),
        kind,
        title: MANUAL_TITLE,
        footer: MANUAL_TITLE,
      });
    } catch {
      return { ok: false, cancelled: false, why: 'it could not be printed' };
    }
  }
}
