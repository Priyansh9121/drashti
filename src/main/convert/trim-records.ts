import { readFileSync, writeFileSync } from 'node:fs';

/*
 * RED STUB (FT-4): Trim's records as they behave today, each change written at once on Main, nothing read from the
 * library's settings, nothing written at quit. The fix replaces it.
 */

export interface TrimRecordsOptions {
  before: { waiting: () => unknown; copies: () => unknown };
  otherLibrary?: boolean;
  log?: (message: string) => void;
  writeFile?: (file: string, text: string) => Promise<void>;
  renameSync?: (from: string, to: string) => void;
  retryMs?: number;
}

export class TrimRecords {
  private waiting: unknown[] = [];
  private copyRecords: unknown[] = [];

  readonly kept = {
    load: (): unknown[] => this.waiting,
    save: (cuts: readonly unknown[]): void => {
      this.waiting = [...cuts];
      this.write();
    },
  };

  readonly copies = {
    load: (): unknown[] => this.copyRecords,
    save: (copies: readonly unknown[]): void => {
      this.copyRecords = [...copies];
      this.write();
    },
  };

  constructor(
    private readonly file: string,
    _options: TrimRecordsOptions,
  ) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { waiting: unknown[]; copies: unknown[] };
      this.waiting = raw.waiting;
      this.copyRecords = raw.copies;
    } catch {
      // None.
    }
  }

  saveNow(): void {
    // Written at once already.
  }

  quit(): void {
    // Written at once already.
  }

  settle(): Promise<void> {
    return Promise.resolve();
  }

  private write(): void {
    writeFileSync(this.file, JSON.stringify({ version: 1, waiting: this.waiting, copies: this.copyRecords }));
  }
}
