import type { ManualPrinted, ManualRead } from '../shared/manual';
import type { GuideFiles } from './guides';
import type { printManual } from './manual-print';

/*
 * The Drashti Manual's side in the main process (x37, Session 60): the red commit's stand-in, which reads and prints
 * nothing yet.
 */

export function readManual(files: GuideFiles): ManualRead {
  return { ok: false, message: `Not yet: ${files.dir}.` };
}

export function manualPage(files: GuideFiles, version: string): { html: string; pictures: string[] } | null {
  return files.dir === version ? { html: '', pictures: [] } : null;
}

export interface ManualPrinterDeps {
  files: GuideFiles;
  version: () => string;
  tempDir: () => string;
  askWhere: (suggested: string) => Promise<string | null>;
  suggestedFolder: () => string;
  print?: typeof printManual;
  write?: (file: string, data: Buffer) => void;
}

export const MANUAL_PDF_NAME = 'Drashti Manual.pdf';

export class ManualPrinter {
  constructor(private readonly deps: ManualPrinterDeps) {}

  print(): Promise<ManualPrinted> {
    return Promise.resolve({ ok: false, cancelled: false, message: `Not yet: ${this.deps.version()}.` });
  }

  pdf(): Promise<ManualPrinted> {
    return Promise.resolve({ ok: false, cancelled: false, message: `Not yet: ${this.deps.version()}.` });
  }
}
