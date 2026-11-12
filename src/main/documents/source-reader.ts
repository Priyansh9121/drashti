import type { PreparedSource, PreparedSourcePage } from '../../shared/editable-source';

export interface SourceRead {
  ext: 'pdf' | 'pptx';
  file: string;
  outDir: string;
  sourcePages: number[];
  /**
   * PowerPoint only: the pages among `sourcePages` whose clicks and transition to read too, as alpha.17's import reads
   * them (W6's review N4: slides imported before alpha.17 that play PowerPoint's clips).
   */
  timingPages?: number[];
  signal: AbortSignal;
  /** Main's monotonic deadline, including time waiting for a turn. */
  deadlineAt?: number;
  /** Authoritative Main guard + asynchronous CPU give-way; false cancels this generation. */
  checkpoint(): Promise<boolean>;
  /** Main has validated this PDF page, or kept its saved picture when no page was returned. */
  onPdfPage?(index: number, page?: PreparedSourcePage): Promise<void>;
  /**
   * True while the show needs the computer (Session 57: anything up, or the stream on air or recording): the PDF job
   * ends at its next checkpoint or page, leaving the pages it has not read as `unread`, never failed. It never waits
   * inside the job, so no clock of the job's runs while the show goes on, and the shared queues are free meanwhile.
   */
  pdfHold?(): boolean;
  /**
   * The bytes one PDF's preparation has kept so far, shared by all its jobs: each job counts its budgets from here
   * and adds what it keeps, so ending a job for the show never gives one PDF more than one job's budgets.
   */
  pdfBudget?: { assetBytes: number; metadataBytes: number };
}
export type SourceReader = (request: SourceRead) => Promise<PreparedSource>;

/** Instantiate once in Main; no renderer/test environment switch chooses an implementation. */
export function sourceReader(pdf: SourceReader, pptx: SourceReader): SourceReader {
  return (request) => (request.ext === 'pdf' ? pdf(request) : pptx(request));
}

// Deliberately not a default Node fallback. Unit native-source tests explicitly inject their real adapter.
export const unavailableSourceReader: SourceReader = () =>
  Promise.resolve({
    ok: false,
    message: 'Drashti can’t read the original’s words and shapes now. The slides still show as before.',
  });

/** Authority checks cannot strand a cancelled source generation, even if their yield is still pending. */
export function sourceCheckpoint(request: SourceRead): Promise<boolean> {
  if (request.signal.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (allowed: boolean) => {
      if (settled) return;
      settled = true;
      request.signal.removeEventListener('abort', abort);
      resolve(allowed && !request.signal.aborted);
    };
    const abort = () => finish(false);
    request.signal.addEventListener('abort', abort, { once: true });
    void Promise.resolve()
      .then(() => request.checkpoint())
      .then(finish, () => finish(false));
    if (request.signal.aborted) abort();
  });
}

export function sourceTimeLeft(request: SourceRead): number {
  return Math.max(
    1,
    Math.min(180_000, (request.deadlineAt ?? performance.now() + 180_000) - performance.now()),
  );
}
